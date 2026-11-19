import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import type { StaffActor } from "../middleware/auth.js";
import type { SectionInput, academicQuery } from "../validation/academic.validation.js";
import { HttpError } from "../utils/http-error.js";
import { projectRoster, projectSection, sectionSelect } from "./academic.projection.js";

async function references(tx: Prisma.TransactionClient, input: Partial<SectionInput>) {
  if (input.courseId !== undefined) {
    const courses = await tx.$queryRaw<{ id: number }[]>`SELECT "id" FROM "Course" WHERE "id" = ${input.courseId} FOR KEY SHARE`;
    if (!courses.length) throw new HttpError(400, "Referenced course does not exist");
  }
  if (input.lecturerId !== undefined) {
    // Serialize assignment with lecturer deactivation; profile edits need not
    // reassign an existing inactive lecturer unless lecturerId is supplied.
    await tx.$queryRaw`SELECT "id" FROM "Staff" WHERE "id" = ${input.lecturerId} FOR UPDATE`;
    if (!await tx.staff.findFirst({ where: { id: input.lecturerId, role: "LECTURER", status: "Active" }, select: { id: true } })) throw new HttpError(400, "Assigned lecturer must exist, have the LECTURER role, and be Active");
  }
}
async function uniqueSection<T>(operation: () => Promise<T>) {
  try { return await operation(); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new HttpError(409, "Section code is already in use for this course, academic year and term");
    throw error;
  }
}
export async function listSections(query: ReturnType<typeof academicQuery>, actor: StaffActor) {
  const filters = { courseId: query.courseId, lecturerId: query.lecturerId, academicYear: query.academicYear, term: query.term };
  // Intersect caller filters with server-owned identity. Never spread filters
  // over the authorization scope or trust a supplied lecturerId as the actor.
  const where: Prisma.ClassSectionWhereInput = { AND: [filters, actor.role === "ADMIN" ? {} : { lecturerId: actor.id }] };
  return prisma.$transaction(async tx => {
    const total = await tx.classSection.count({ where });
    const rows = await tx.classSection.findMany({ where, select: sectionSelect, orderBy: [{ academicYear: "desc" }, { term: "asc" }, { code: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.limit, take: query.limit });
    return { classSections: rows.map(projectSection), pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
export async function getSection(id: string, actor: StaffActor) {
  const section = await prisma.classSection.findFirst({ where: { id, ...(actor.role === "ADMIN" ? {} : { lecturerId: actor.id }) }, select: sectionSelect });
  if (!section) throw new HttpError(404, "Class section not found");
  return { ...projectSection(section), roster: projectRoster(section) };
}
export async function createSection(input: SectionInput, actorId: string) {
  return uniqueSection(() => prisma.$transaction(async tx => {
    await references(tx, input);
    const section = await tx.classSection.create({ data: input, select: sectionSelect });
    await tx.auditEntry.create({ data: { actorId, sectionId: section.id, action: "CLASS_SECTION_CREATED", details: { profile: input } } });
    return projectSection(section);
  }));
}
export async function updateSection(id: string, input: Partial<SectionInput>, actorId: string) {
  return uniqueSection(() => prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "ClassSection" WHERE "id" = ${id} FOR UPDATE`;
    const before = await tx.classSection.findUnique({ where: { id }, select: sectionSelect });
    if (!before) throw new HttpError(404, "Class section not found");
    await references(tx, input);
    const changedFields = (Object.keys(input) as (keyof SectionInput)[]).filter(key => before[key] !== input[key]);
    if (!changedFields.length) return projectSection(before);
    const section = await tx.classSection.update({ where: { id }, data: input, select: sectionSelect });
    await tx.auditEntry.create({ data: { actorId, sectionId: id, action: "CLASS_SECTION_UPDATED", details: { changedFields,
      before: Object.fromEntries(changedFields.map(key => [key, before[key]])), after: Object.fromEntries(changedFields.map(key => [key, section[key]])) } } });
    return projectSection(section);
  }));
}
