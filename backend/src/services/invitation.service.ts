import { randomBytes } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { invitationConfig, invitationAvailability } from "../config/invitations.js";
import { HttpError } from "../utils/http-error.js";
import { digest } from "./auth.service.js";
import { hashPassword } from "./password.service.js";
import { sendInvitationMail } from "../integrations/invitation-mail.js";

export async function requestLecturerInvitation(lecturerId: string, actorId: string) {
  const token = randomBytes(32).toString("base64url");
  const prepared = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Staff" WHERE "id" = ${lecturerId} FOR UPDATE`;
    const lecturer = await tx.staff.findFirst({ where: { id: lecturerId, role: "LECTURER" }, select: { id: true, status: true, email: true, passwordHash: true } });
    if (!lecturer) throw new HttpError(404, "Lecturer not found");
    let failure: { status: number; outcome: string; error: string } | undefined;
    if (lecturer.status !== "Active") failure = { status: 409, outcome: "REJECTED_INACTIVE", error: "Inactive lecturers cannot be invited" };
    else if (lecturer.passwordHash !== null) failure = { status: 409, outcome: "REJECTED_ALREADY_PROVISIONED", error: "Lecturer account is already provisioned" };
    let frontend = "";
    if (!failure) {
      try { frontend = invitationConfig().frontend; }
      catch (error) { failure = { status: 503, outcome: "UNAVAILABLE", error: error instanceof HttpError ? error.message : invitationAvailability.message }; }
    }
    if (failure) {
      await tx.auditEntry.create({ data: { actorId, lecturerId, action: "LECTURER_INVITATION_ATTEMPTED", details: { outcome: failure.outcome, deliveryStatus: "NOT_ATTEMPTED", provisioningStatus: "NOT_ATTEMPTED" } } });
      return { failure };
    }
    const recent = await tx.lecturerInvitation.findFirst({ where: { lecturerId, createdAt: { gt: new Date(Date.now() - 60000) } }, select: { id: true } });
    if (recent) throw new HttpError(429, "Wait 60 seconds before resending this lecturer's invitation");
    const now = new Date();
    await tx.lecturerInvitation.updateMany({ where: { lecturerId, consumedAt: null, revokedAt: null }, data: { revokedAt: now } });
    const invitation = await tx.lecturerInvitation.create({ data: { lecturerId, adminId: actorId, email: lecturer.email.toLowerCase(), tokenHash: digest(token), expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000) } });
    await tx.auditEntry.create({ data: { actorId, lecturerId, action: "LECTURER_INVITATION_ATTEMPTED", details: { outcome: "PREPARED", deliveryStatus: "PENDING", provisioningStatus: "NOT_ATTEMPTED" } } });
    return { invitation, frontend };
  });
  if (prepared.failure) return { status: prepared.failure.status, body: { error: prepared.failure.error, invitation: { outcome: prepared.failure.outcome, deliveryStatus: "NOT_ATTEMPTED", provisioningStatus: "NOT_ATTEMPTED" } } };
  const { invitation, frontend } = prepared;
  let accepted = false;
  try {
    await sendInvitationMail(invitation.email, `${frontend}/activate-lecturer#token=${token}`, invitation.expiresAt);
    accepted = true;
  } catch { /* Never expose transport exceptions, recipient content or links. */ }
  // External mail acceptance and DB commits cannot be one distributed atomic
  // transaction. Only a durably ACCEPTED invitation may be redeemed; a crash
  // leaves PENDING, requiring resend. Replacements always revoke the old link.
  const usable = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Staff" WHERE "id" = ${lecturerId} FOR UPDATE`;
    const lecturer = await tx.staff.findUnique({ where: { id: lecturerId }, select: { status: true, passwordHash: true, email: true } });
    const current = await tx.lecturerInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
    const eligible = lecturer?.status === "Active" && lecturer.passwordHash === null && lecturer.email.toLowerCase() === invitation.email && !current.revokedAt;
    await tx.lecturerInvitation.update({ where: { id: invitation.id }, data: { delivery: accepted ? "ACCEPTED" : "UNCONFIRMED", acceptedAt: accepted ? new Date() : null, ...(!eligible ? { revokedAt: new Date() } : {}) } });
    await tx.auditEntry.create({ data: { actorId, lecturerId, action: "LECTURER_INVITATION_ATTEMPTED", details: { outcome: accepted ? "ACCEPTED" : "DELIVERY_UNCONFIRMED", deliveryStatus: accepted ? "ACCEPTED" : "UNCONFIRMED", provisioningStatus: "NOT_ATTEMPTED" } } });
    return eligible;
  });
  if (!usable) return { status: 409, body: { error: "Lecturer eligibility changed; this invitation cannot be used" } };
  if (!accepted) return { status: 503, body: { error: "Mail service did not confirm acceptance. Check mail configuration and retry after 60 seconds.", invitation: { outcome: "DELIVERY_UNCONFIRMED", deliveryStatus: "UNCONFIRMED" } } };
  return { status: 202, body: { invitation: { outcome: "ACCEPTED", deliveryStatus: "ACCEPTED", expiresAt: invitation.expiresAt } } };
}

export async function redeemLecturerInvitation(token: string, password: string) {
  const tokenHash = digest(token);
  const passwordHash = await hashPassword(password);
  const invalid = () => new HttpError(400, "Invitation link is invalid or expired. Ask an administrator for a new invitation.");
  return prisma.$transaction(async tx => {
    const reference = await tx.lecturerInvitation.findUnique({ where: { tokenHash }, select: { lecturerId: true } });
    if (!reference) throw invalid();
    await tx.$queryRaw`SELECT "id" FROM "Staff" WHERE "id" = ${reference.lecturerId} FOR UPDATE`;
    const invitation = await tx.lecturerInvitation.findUniqueOrThrow({ where: { tokenHash } });
    const lecturer = await tx.staff.findUnique({ where: { id: reference.lecturerId } });
    if (invitation.revokedAt || invitation.consumedAt || invitation.delivery !== "ACCEPTED" || invitation.expiresAt.getTime() <= Date.now() ||
        !lecturer || lecturer.role !== "LECTURER" || lecturer.status !== "Active" || lecturer.passwordHash !== null || lecturer.email.toLowerCase() !== invitation.email) throw invalid();
    const now = new Date();
    await tx.staff.update({ where: { id: lecturer.id }, data: { passwordHash, role: "LECTURER" } });
    await tx.staffSession.deleteMany({ where: { staffId: lecturer.id } });
    await tx.lecturerInvitation.update({ where: { id: invitation.id }, data: { consumedAt: now } });
    await tx.lecturerInvitation.updateMany({ where: { lecturerId: lecturer.id, id: { not: invitation.id }, consumedAt: null, revokedAt: null }, data: { revokedAt: now } });
    // Token redemption authenticates this existing lecturer identity. No admin
    // actor is fabricated; the issuing admin remains on the invitation record.
    await tx.auditEntry.create({ data: { actorId: lecturer.id, lecturerId: lecturer.id, action: "LECTURER_ACTIVATED", details: { outcome: "ACTIVATED" } } });
    return { activated: true };
  });
}
