import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import type { LecturerInput, lecturerQuery } from "../validation/lecturer.validation.js";
import { HttpError } from "../utils/http-error.js";
import { projectSection, sectionSelect } from "./academic.projection.js";

const lecturerSelect = { id: true, name: true, email: true, role: true, status: true } as const;
async function lockLecturer(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "Staff" WHERE "id" = ${id} FOR UPDATE`;
  const lecturer = await tx.staff.findFirst({ where: { id, role: "LECTURER" }, select: lecturerSelect });
  if (!lecturer) throw new HttpError(404, "Lecturer not found");
  return lecturer;
}
async function uniqueEmail<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new HttpError(409, "Email is already in use");
    throw error;
  }
}
export async function listLecturers(query: ReturnType<typeof lecturerQuery>) {
  const where: Prisma.StaffWhereInput = { role: "LECTURER", status: query.status };
  if (query.search) where.OR = ["name", "email"].map(field => ({ [field]: { contains: query.search, mode: "insensitive" } }));
  return prisma.$transaction(async tx => {
    const total = await tx.staff.count({ where });
    const lecturers = await tx.staff.findMany({ where, select: lecturerSelect, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.limit, take: query.limit });
    return { lecturers, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
export async function getLecturer(id: string) {
  const lecturer = await prisma.staff.findFirst({ where: { id, role: "LECTURER" }, select: { ...lecturerSelect,
    passwordHash: true, lecturerInvitations: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { createdAt: true, expiresAt: true, delivery: true, revokedAt: true } },
    assignedSections: { select: sectionSelect, orderBy: [{ academicYear: "desc" }, { term: "asc" }, { code: "asc" }, { id: "asc" }] } } });
  if (!lecturer) throw new HttpError(404, "Lecturer not found");
  const { assignedSections, passwordHash, lecturerInvitations, ...profile } = lecturer;
  const latest = lecturerInvitations[0];
  return { ...profile, assignedClasses: assignedSections.map(projectSection), accountSetup: {
    status: passwordHash !== null ? "ACTIVATED" : !latest ? "AWAITING_SETUP" : latest.revokedAt || latest.expiresAt.getTime() <= Date.now() ? "INVITATION_EXPIRED" : latest.delivery === "ACCEPTED" ? "INVITATION_PENDING" : "DELIVERY_UNCONFIRMED",
    lastInvitationAt: latest?.createdAt ?? null, expiresAt: latest?.expiresAt ?? null, deliveryStatus: latest?.delivery ?? null,
    canInvite: profile.status === "Active" && passwordHash === null,
  } };
}
export async function createLecturer(input: LecturerInput, actorId: string) {
  return uniqueEmail(() => prisma.$transaction(async tx => {
    const lecturer = await tx.staff.create({ data: { ...input, role: "LECTURER", status: "Active", passwordHash: null }, select: lecturerSelect });
    await tx.auditEntry.create({ data: { actorId, lecturerId: lecturer.id, action: "LECTURER_CREATED", details: { profile: input, status: "Active", provisioned: false } } });
    return lecturer;
  }));
}
export async function updateLecturer(id: string, input: Partial<LecturerInput>, actorId: string) {
  return uniqueEmail(() => prisma.$transaction(async tx => {
    const before = await lockLecturer(tx, id);
    const changedFields = (Object.keys(input) as (keyof LecturerInput)[]).filter(key => input[key] !== before[key]);
    if (!changedFields.length) return before;
    const lecturer = await tx.staff.update({ where: { id }, data: input, select: lecturerSelect });
    if (changedFields.includes("email")) await tx.lecturerInvitation.updateMany({ where: { lecturerId: id, consumedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.auditEntry.create({ data: { actorId, lecturerId: id, action: "LECTURER_UPDATED", details: { changedFields,
      before: Object.fromEntries(changedFields.map(key => [key, before[key]])), after: Object.fromEntries(changedFields.map(key => [key, lecturer[key]])) } } });
    return lecturer;
  }));
}
export async function setLecturerStatus(id: string, status: "Active" | "Inactive", actorId: string) {
  return prisma.$transaction(async tx => {
    const before = await lockLecturer(tx, id);
    // Always clear sessions on an Inactive request, including idempotent retries.
    const revoked = status === "Inactive" ? await tx.staffSession.deleteMany({ where: { staffId: id } }) : { count: 0 };
    if (status === "Inactive") await tx.lecturerInvitation.updateMany({ where: { lecturerId: id, consumedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    if (before.status === status && !revoked.count) return before;
    const lecturer = await tx.staff.update({ where: { id }, data: { status }, select: lecturerSelect });
    await tx.auditEntry.create({ data: { actorId, lecturerId: id, action: "LECTURER_STATUS_CHANGED", details: {
      before: before.status, after: status, sessionsRevoked: revoked.count,
    } } });
    return lecturer;
  });
}
