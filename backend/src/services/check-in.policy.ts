import type { Prisma } from "../generated/prisma/client.js";
import type { DevicePrincipal } from "../integrations/check-in.js";
import { HttpError } from "../utils/http-error.js";

export async function lockCheckInDevice(tx: Prisma.TransactionClient, principal: DevicePrincipal) {
  await tx.$queryRaw`SELECT "id" FROM "DevelopmentCheckInDevice" WHERE "id" = ${principal.id} FOR UPDATE`;
  const device = await tx.developmentCheckInDevice.findUnique({ where: { id: principal.id }, include: { terminal: { select: { isFictional: true } } } });
  if (!device?.active || !device.terminal.isFictional) throw new HttpError(401, "Invalid device credentials");
  if (device.terminalId !== principal.terminalId) throw new HttpError(403, "Device terminal binding changed");
  return device;
}
// Call after locking the section and session. Snapshot only register fields.
export async function lockEligibleStudent(tx: Prisma.TransactionClient, sectionId: string, studentId: string, consentId?: string) {
  await tx.$queryRaw`SELECT "id" FROM "Student" WHERE "id" = ${studentId} FOR UPDATE`;
  const student = await tx.student.findUnique({ where: { id: studentId }, select: {
    id: true, studentId: true, name: true, isFictional: true, faceEnrollment: true, fingerprintEnrollment: true,
  } });
  const member = await tx.sectionRosterMembership.findUnique({ where: { sectionId_studentId: { sectionId, studentId } } });
  const consent = await tx.studentConsent.findFirst({ where: { studentId, ...(consentId ? { id: consentId } : {}) }, orderBy: [{ recordedAt: "desc" }, { id: "desc" }], select: { id: true } });
  const deletion = await tx.captureAttempt.findFirst({ where: { studentId, status: "REQUESTED", operation: { in: ["REMOVE", "RESET"] } }, select: { id: true } });
  if (!student?.isFictional || !member || !consent || student.faceEnrollment !== "Enrolled" || student.fingerprintEnrollment !== "Enrolled" || deletion) return null;
  return { id: student.id, indexNumber: student.studentId, name: student.name, consentId: consent.id };
}
