import { prisma } from "../db/prisma.js";
import { invitationAvailability } from "../config/invitations.js";
import { HttpError } from "../utils/http-error.js";

export async function requestLecturerInvitation(lecturerId: string, actorId: string) {
  return prisma.$transaction(async tx => {
    // Serialize eligibility checks and audit attribution with status/profile edits.
    await tx.$queryRaw`SELECT "id" FROM "Staff" WHERE "id" = ${lecturerId} FOR UPDATE`;
    const lecturer = await tx.staff.findFirst({ where: { id: lecturerId, role: "LECTURER" }, select: {
      id: true, status: true, passwordHash: true,
    } });
    if (!lecturer) throw new HttpError(404, "Lecturer not found");

    const result = lecturer.status !== "Active"
      ? { status: 409, outcome: "REJECTED_INACTIVE", error: "Inactive lecturers cannot be invited" }
      : lecturer.passwordHash !== null
        ? { status: 409, outcome: "REJECTED_ALREADY_PROVISIONED", error: "Lecturer account is already provisioned" }
        : { status: 503, outcome: "UNAVAILABLE", error: invitationAvailability.message };

    await tx.auditEntry.create({ data: {
      actorId, lecturerId, action: "LECTURER_INVITATION_ATTEMPTED", details: {
        outcome: result.outcome, deliveryStatus: "NOT_ATTEMPTED", provisioningStatus: "NOT_ATTEMPTED",
        ...(result.status === 503 ? { missing: ["TRUSTED_PROVISIONING_FLOW", "INVITATION_DELIVERY_TRANSPORT"] } : {}),
      },
    } });
    // Return a result rather than throwing inside the transaction: the actual
    // unavailable/rejected outcome must commit to audit before the HTTP error.
    // No invitation, credential, session or delivery request is created.
    return { status: result.status, body: { error: result.error,
      invitation: { outcome: result.outcome, deliveryStatus: "NOT_ATTEMPTED", provisioningStatus: "NOT_ATTEMPTED" } } };
  });
}
