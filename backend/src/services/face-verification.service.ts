import { randomBytes, randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { digest } from "./auth.service.js";
import { developmentFaceIdentifier, requireCheckInIntegration, type DevicePrincipal, type FaceCaptureContext } from "../integrations/check-in.js";
import { HttpError } from "../utils/http-error.js";
import { lockCheckInDevice as lockDevice, lockEligibleStudent } from "./check-in.policy.js";

type Failure = { error: { status: number; message: string } };
const failure = (status: number, message: string): Failure => ({ error: { status, message } });
export async function verifyFace(principal: DevicePrincipal) {
  requireCheckInIntegration();
  const context = await prisma.$transaction(async tx => {
    await lockDevice(tx, principal);
    await tx.faceVerificationAttempt.updateMany({ where: { deviceId: principal.id, status: "WAITING_FINGERPRINT" }, data: { status: "INVALIDATED" } });
    const challengeId = randomUUID();
    await tx.developmentCheckInDevice.update({ where: { id: principal.id }, data: { faceChallengeId: challengeId } });
    const session = await tx.attendanceSession.findFirst({ where: { terminalId: principal.terminalId, status: "OPEN" }, select: {
      id: true, sectionId: true, section: { select: { isFictional: true, rosterMemberships: {
        where: { student: { isFictional: true } }, select: { studentId: true },
      } } },
    } });
    if (!session) return failure(409, "No open attendance session at this terminal");
    if (!session.section.isFictional) return failure(503, "Development check-ins require a fictional class section");
    return { challengeId, deviceId: principal.id, terminalId: principal.terminalId, attendanceSessionId: session.id,
      sectionId: session.sectionId, rosterStudentIds: session.section.rosterMemberships.map(member => member.studentId) } satisfies FaceCaptureContext;
  });
  // These failures are returned after commit so older attempts stay invalidated.
  if ("error" in context) throw new HttpError(context.error.status, context.error.message);
  // A real network/capture call belongs OUTSIDE the database transaction.
  const result = await developmentFaceIdentifier.identify(context);
  requireCheckInIntegration();
  if (result.serviceId !== developmentFaceIdentifier.serviceId || result.challengeId !== context.challengeId || result.deviceId !== principal.id ||
      result.terminalId !== principal.terminalId || result.attendanceSessionId !== context.attendanceSessionId) throw new HttpError(409, "Face confirmation does not match the check-in context");
  if (!result.studentId || !context.rosterStudentIds.includes(result.studentId)) throw new HttpError(422, "Face verification failed; retry capture");
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 120000);
  await prisma.$transaction(async tx => {
    const device = await lockDevice(tx, principal);
    if (device.faceChallengeId !== context.challengeId) throw new HttpError(409, "Face request was superseded; retry capture");
    // Lock order: device -> section -> attendance session -> student. Roster
    // edits lock the section; close locks the session; enrollments lock student.
    await tx.$queryRaw`SELECT "id" FROM "ClassSection" WHERE "id" = ${context.sectionId} FOR UPDATE`;
    const section = await tx.classSection.findUnique({ where: { id: context.sectionId }, select: { isFictional: true } });
    await tx.$queryRaw`SELECT "id" FROM "AttendanceSession" WHERE "id" = ${context.attendanceSessionId} FOR UPDATE`;
    const session = await tx.attendanceSession.findUnique({ where: { id: context.attendanceSessionId } });
    if (!section?.isFictional || !session || session.status !== "OPEN" || session.terminalId !== principal.terminalId || session.sectionId !== context.sectionId) throw new HttpError(409, "Attendance session is no longer open for this attempt");
    const student = await lockEligibleStudent(tx, context.sectionId, result.studentId!);
    if (!student) throw new HttpError(422, "Face verification failed; student is not eligible for check-in");
    await tx.faceVerificationAttempt.create({ data: { tokenHash: digest(token), deviceId: principal.id, terminalId: principal.terminalId,
      attendanceSessionId: session.id, studentId: result.studentId!, consentId: student.consentId, serviceId: result.serviceId,
      challengeId: context.challengeId, expiresAt, developmentOnly: true } });
  });
  // No identity or attendance is returned/written. This opaque token is the only
  // client handle; the database stores its hash, never the raw attempt token.
  return { attemptId: token, nextStep: "fingerprint-verification", expiresAt, developmentOnly: true };
}
