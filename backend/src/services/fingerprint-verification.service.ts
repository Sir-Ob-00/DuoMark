import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";
import { digest } from "./auth.service.js";
import { publishChange } from "./events.service.js";
import { lockCheckInDevice, lockEligibleStudent } from "./check-in.policy.js";
import { developmentFaceIdentifier, developmentFingerprintVerifier, requireCheckInIntegration, type DevicePrincipal, type FingerprintContext } from "../integrations/check-in.js";

type Receipt = { id: string; recordedAt: Date };
export type CheckInResult = { status: number; body: { outcome: string; error?: string; attendance?: Receipt; replayed?: boolean; developmentOnly?: boolean } };
const failed = (status: number, outcome: string, error: string): CheckInResult => ({ status, body: { outcome, error } });
type Attempt = Prisma.FaceVerificationAttemptGetPayload<{}>;
async function invalidate(tx: Prisma.TransactionClient, attempt: Attempt, result: CheckInResult) {
  await tx.faceVerificationAttempt.update({ where: { id: attempt.id }, data: { status: "INVALIDATED", finalizedAt: new Date() } });
  return result;
}
async function loadAttempt(tx: Prisma.TransactionClient, tokenHash: string, principal: DevicePrincipal): Promise<{ response: CheckInResult } | { attempt: Attempt }> {
  const device = await lockCheckInDevice(tx, principal);
  await tx.$queryRaw`SELECT "id" FROM "FaceVerificationAttempt" WHERE "tokenHash" = ${tokenHash} AND "deviceId" = ${principal.id} FOR UPDATE`;
  const attempt = await tx.faceVerificationAttempt.findUnique({ where: { tokenHash } });
  if (!attempt) return { response: failed(404, "attempt-invalid", "Face-verification attempt not found") };
  if (attempt.deviceId !== principal.id || attempt.terminalId !== principal.terminalId) return { response: failed(403, "device-error", "Attempt is not bound to this device and terminal") };
  if (!attempt.developmentOnly || attempt.serviceId !== developmentFaceIdentifier.serviceId) return { response: failed(403, "device-error", "Untrusted face-verification provenance") };
  // Completed retries acknowledge durable state even after expiry/closure or a
  // newer face challenge. They never reinsert attendance or repeat the audit.
  if (attempt.status === "CONSUMED") {
    const record = attempt.attendanceRecordId ? await tx.attendanceRecord.findFirst({ where: { id: attempt.attendanceRecordId,
      sessionId: attempt.attendanceSessionId, studentId: attempt.studentId }, select: { id: true, recordedAt: true } }) : null;
    if (!record || !attempt.completionOutcome) return { response: failed(409, "attempt-invalid", "Completed attempt has no attendance receipt") };
    return { response: { status: 200, body: { outcome: attempt.completionOutcome === "RECORDED" ? "attendance-recorded" : "already-recorded", attendance: record, replayed: true, developmentOnly: true } } satisfies CheckInResult };
  }
  if (attempt.expiresAt.getTime() <= Date.now()) return { response: await invalidate(tx, attempt, failed(410, "attempt-expired", "Face-verification attempt expired; restart face verification")) };
  if (attempt.status !== "WAITING_FINGERPRINT" || device.faceChallengeId !== attempt.challengeId) return { response: failed(409, "attempt-invalid", "Attempt is no longer valid; restart face verification") };
  return { attempt };
}
async function lockReadyContext(tx: Prisma.TransactionClient, attempt: Attempt): Promise<{ response: CheckInResult } | { student: NonNullable<Awaited<ReturnType<typeof lockEligibleStudent>>> }> {
  const reference = await tx.attendanceSession.findUnique({ where: { id: attempt.attendanceSessionId }, select: { sectionId: true } });
  if (!reference) return { response: await invalidate(tx, attempt, failed(409, "session-error", "Attendance session not found")) };
  await tx.$queryRaw`SELECT "id" FROM "ClassSection" WHERE "id" = ${reference.sectionId} FOR UPDATE`;
  // Same row lock as closeSession: whichever commits first defines the result.
  await tx.$queryRaw`SELECT "id" FROM "AttendanceSession" WHERE "id" = ${attempt.attendanceSessionId} FOR UPDATE`;
  const session = await tx.attendanceSession.findUnique({ where: { id: attempt.attendanceSessionId }, select: { status: true, terminalId: true, sectionId: true, section: { select: { isFictional: true } } } });
  if (!session || session.status !== "OPEN" || session.terminalId !== attempt.terminalId || session.sectionId !== reference.sectionId) return { response: await invalidate(tx, attempt, failed(409, "session-error", "Original attendance session is no longer open on this terminal")) };
  const student = await lockEligibleStudent(tx, session.sectionId, attempt.studentId, attempt.consentId);
  if (!session.section.isFictional || !student) return { response: await invalidate(tx, attempt, failed(422, "student-ineligible", "Student is no longer eligible; restart face verification")) };
  return { student };
}
export async function verifyFingerprint(principal: DevicePrincipal, attemptToken: string): Promise<CheckInResult> {
  requireCheckInIntegration();
  const tokenHash = digest(attemptToken);
  const prepared = await prisma.$transaction(async tx => {
    const loaded = await loadAttempt(tx, tokenHash, principal);
    if ("response" in loaded) return loaded;
    const ready = await lockReadyContext(tx, loaded.attempt);
    if ("response" in ready) return ready;
    // Stable per-attempt challenge makes concurrent/retried capture requests
    // idempotent at the integration boundary, without holding DB locks in capture.
    const challengeId = loaded.attempt.fingerprintChallengeId ?? randomUUID();
    if (!loaded.attempt.fingerprintChallengeId) await tx.faceVerificationAttempt.update({ where: { id: loaded.attempt.id }, data: { fingerprintChallengeId: challengeId } });
    return { context: { challengeId, attemptId: loaded.attempt.id, deviceId: principal.id, terminalId: principal.terminalId,
      attendanceSessionId: loaded.attempt.attendanceSessionId, studentId: loaded.attempt.studentId } satisfies FingerprintContext };
  });
  if ("response" in prepared) return prepared.response!;
  const context = prepared.context;
  const result = await developmentFingerprintVerifier.verify(context);
  requireCheckInIntegration();
  const committed = await prisma.$transaction(async tx => {
    const loaded = await loadAttempt(tx, tokenHash, principal);
    if ("response" in loaded) return loaded.response!;
    const attempt = loaded.attempt;
    const ready = await lockReadyContext(tx, attempt);
    if ("response" in ready) return ready.response!;
    if (attempt.fingerprintChallengeId !== context.challengeId || result.serviceId !== developmentFingerprintVerifier.serviceId ||
        result.challengeId !== context.challengeId || result.attemptId !== attempt.id || result.deviceId !== principal.id || result.terminalId !== principal.terminalId ||
        result.attendanceSessionId !== attempt.attendanceSessionId || result.studentId !== attempt.studentId || typeof result.verified !== "boolean") {
      return invalidate(tx, attempt, failed(409, "device-error", "Fingerprint confirmation does not match the trusted attempt context"));
    }
    if (!result.verified) return invalidate(tx, attempt, failed(422, "verification-failed", "Fingerprint verification failed; restart face verification"));
    const recordedAt = new Date();
    if (recordedAt.getTime() >= attempt.expiresAt.getTime()) return invalidate(tx, attempt, failed(410, "attempt-expired", "Face-verification attempt expired; restart face verification"));
    // skipDuplicates handles even a competing DB writer without aborting this
    // transaction. The unique session/student key is the final deduplication guard.
    const inserted = await tx.attendanceRecord.createMany({ data: [{ id: randomUUID(), sessionId: attempt.attendanceSessionId, studentId: attempt.studentId,
      studentIndexNumber: ready.student.indexNumber, studentName: ready.student.name, deviceId: principal.id, terminalId: principal.terminalId, recordedAt, developmentOnly: true }], skipDuplicates: true });
    const record = await tx.attendanceRecord.findUniqueOrThrow({ where: { sessionId_studentId: { sessionId: attempt.attendanceSessionId, studentId: attempt.studentId } }, select: { id: true, recordedAt: true } });
    const completionOutcome = inserted.count ? "RECORDED" : "ALREADY_RECORDED";
    await tx.faceVerificationAttempt.update({ where: { id: attempt.id }, data: { status: "CONSUMED", completionOutcome,
      attendanceRecordId: record.id, finalizedAt: new Date(), fingerprintServiceId: result.serviceId } });
    if (inserted.count) await tx.auditEntry.create({ data: { deviceActorId: principal.id, attendanceRecordId: record.id, action: "ATTENDANCE_RECORDED",
      details: { sessionId: attempt.attendanceSessionId, terminalId: principal.terminalId, verificationAttemptId: attempt.id, serviceId: result.serviceId, developmentOnly: true } } });
    return { status: inserted.count ? 201 : 200, body: { outcome: inserted.count ? "attendance-recorded" : "already-recorded", attendance: record, replayed: false, developmentOnly: true } };
  });
  if (committed.status === 201) publishChange({ type: "attendance-recorded", sessionId: context.attendanceSessionId, terminalId: principal.terminalId });
  return committed;
}
