import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { captureService, type CaptureConfirmation } from "../integrations/capture-service.js";
import type { captureInput, modalityInput } from "../validation/capture.validation.js";
import { HttpError } from "../utils/http-error.js";

export const attemptSelect = { id: true, studentId: true, modality: true, operation: true, status: true,
  serviceId: true, deviceId: true, requestedAt: true, expiresAt: true, completedAt: true } as const;
type Command = Prisma.CaptureAttemptGetPayload<{}>;
function view(command: Command) {
  return { id: command.id, studentId: command.studentId, modality: command.modality, operation: command.operation,
    status: command.status, serviceId: command.serviceId, deviceId: command.deviceId,
    requestedAt: command.requestedAt, expiresAt: command.expiresAt, completedAt: command.completedAt };
}
async function lockStudent(tx: Prisma.TransactionClient, studentId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Student" WHERE "id" = ${studentId} FOR UPDATE`;
  const student = await tx.student.findUnique({ where: { id: studentId } });
  if (!student) throw new HttpError(404, "Student not found");
  return student;
}
function auditDetails(command: Command) {
  return { attemptId: command.id, modality: command.modality, operation: command.operation,
    serviceId: command.serviceId, deviceId: command.deviceId, consentId: command.consentId };
}
export async function requestCapture(studentId: string, modality: ReturnType<typeof modalityInput>, input: ReturnType<typeof captureInput>, actorId: string) {
  const service = captureService();
  if (!service.deviceIds.includes(input.deviceId)) throw new HttpError(400, "Device is not approved for the capture service");
  try {
    return await prisma.$transaction(async tx => {
      const student = await lockStudent(tx, studentId);
      const previous = await tx.captureAttempt.findUnique({ where: { requestId: input.requestId } });
      if (previous) {
        if (previous.studentId !== studentId || previous.modality !== modality || previous.operation !== input.operation ||
            previous.deviceId !== input.deviceId || previous.actorId !== actorId || previous.serviceId !== service.serviceId || previous.identityIndexNumber !== input.identityIndexNumber) {
          throw new HttpError(409, "requestId is already bound to another enrollment operation");
        }
        return view(previous);
      }
      let consentId: string | null = null;
      if (input.operation === "ENROLL") {
        if (student.studentId !== input.identityIndexNumber) throw new HttpError(409, "Student identity does not match the verified index number");
        const consent = await tx.studentConsent.findFirst({ where: { studentId }, orderBy: [{ recordedAt: "desc" }, { id: "desc" }] });
        if (!consent) throw new HttpError(409, "Verified consent is required before biometric enrollment");
        consentId = consent.id;
        const field = modality === "face" ? "faceEnrollment" : "fingerprintEnrollment";
        if (student[field] === "Enrolled") throw new HttpError(409, "Modality is already enrolled; confirm removal or reset before enrolling again");
      }
      const active = await tx.captureAttempt.findFirst({ where: { studentId, modality, status: "REQUESTED" } });
      if (active) {
        const expired = active.operation === "ENROLL" && active.expiresAt && active.expiresAt.getTime() <= Date.now();
        if (!expired && (input.operation === "ENROLL" || active.operation !== "ENROLL")) throw new HttpError(409, "An operation is already pending for this student and modality");
        await tx.captureAttempt.update({ where: { id: active.id }, data: { status: "CANCELLED" } });
        await tx.auditEntry.create({ data: { actorId, studentId, action: "BIOMETRIC_CANCELLED", details: {
          ...auditDetails(active), reason: expired ? "expired" : "superseded_by_deletion", initiatedById: active.actorId,
        } } });
      }
      const command = await tx.captureAttempt.create({ data: { ...input, studentId, modality, actorId, consentId,
        serviceId: service.serviceId, expiresAt: input.operation === "ENROLL" ? new Date(Date.now() + 15 * 60 * 1000) : null } });
      await tx.auditEntry.create({ data: { actorId, studentId, action: "BIOMETRIC_REQUESTED", details: {
        ...auditDetails(command), identityVerified: input.operation === "ENROLL", developmentOnly: service.developmentOnly,
      } } });
      return view(command);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new HttpError(409, "Idempotency key or active enrollment operation already exists");
    throw error;
  }
}

// Server-to-server interface only. No HTTP route accepts these confirmations.
// A real adapter MUST obtain principalServiceId from authenticated transport,
// never a JSON field or an administrator's session.
export async function completeCaptureCommand(confirmation: CaptureConfirmation, principalServiceId: string) {
  const service = captureService();
  if (principalServiceId !== service.serviceId) throw new HttpError(403, "Untrusted capture service");
  if (!confirmation || Object.keys(confirmation).some(key => ![
    "attemptId", "studentId", "modality", "operation", "deviceId", "eventId", "consentId", "identityIndexNumber", "identityVerified", "deletionConfirmed",
  ].includes(key)) || typeof confirmation.eventId !== "string" || !/^[A-Za-z0-9:_-]{1,150}$/.test(confirmation.eventId)) throw new HttpError(400, "Invalid metadata-only capture confirmation");
  try {
    return await prisma.$transaction(async tx => {
      const student = await lockStudent(tx, confirmation.studentId);
      const command = await tx.captureAttempt.findUnique({ where: { id: confirmation.attemptId } });
      if (!command) throw new HttpError(404, "Capture attempt not found");
      if (command.studentId !== student.id || command.modality !== confirmation.modality || command.operation !== confirmation.operation ||
          command.serviceId !== principalServiceId || command.deviceId !== confirmation.deviceId || !service.deviceIds.includes(confirmation.deviceId) ||
          command.consentId !== confirmation.consentId || command.identityIndexNumber !== confirmation.identityIndexNumber) throw new HttpError(409, "Confirmation does not match the bound enrollment attempt");
      if (command.operation === "ENROLL" ? confirmation.identityVerified !== true || confirmation.deletionConfirmed !== false : confirmation.deletionConfirmed !== true || confirmation.identityVerified !== false) {
        throw new HttpError(409, "Required identity verification or deletion confirmation is missing");
      }
      if (command.status === "COMPLETED") {
        if (command.confirmationEventId !== confirmation.eventId) throw new HttpError(409, "Attempt already completed with a different event");
        return view(command); // Replay acknowledgement never re-applies a state change.
      }
      if (command.status !== "REQUESTED") throw new HttpError(409, "Attempt is no longer active");
      if (command.operation === "ENROLL") {
        if (!command.expiresAt || command.expiresAt.getTime() <= Date.now()) throw new HttpError(409, "Enrollment attempt expired; start a new attempt");
        if (student.studentId !== command.identityIndexNumber) throw new HttpError(409, "Student identity changed; start a new verified attempt");
        const consent = command.consentId ? await tx.studentConsent.findUnique({ where: { id: command.consentId } }) : null;
        if (!consent || consent.studentId !== student.id) throw new HttpError(409, "Verified consent is required before completion");
      }
      const updated = await tx.captureAttempt.update({ where: { id: command.id }, data: { status: "COMPLETED", completedAt: new Date(), confirmationEventId: confirmation.eventId } });
      const field = command.modality === "face" ? "faceEnrollment" : "fingerprintEnrollment";
      await tx.student.update({ where: { id: student.id }, data: { [field]: command.operation === "ENROLL" ? "Enrolled" : "Pending" } });
      await tx.auditEntry.create({ data: { actorId: command.actorId, studentId: student.id, action: "BIOMETRIC_COMPLETED", details: {
        ...auditDetails(command), completingServiceId: principalServiceId, completingDeviceId: confirmation.deviceId,
        confirmationEventId: confirmation.eventId, deletionConfirmed: confirmation.deletionConfirmed, developmentOnly: service.developmentOnly,
      } } });
      return view(updated);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new HttpError(409, "Confirmation event has already been used");
    throw error;
  }
}
