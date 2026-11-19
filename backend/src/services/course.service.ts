import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import type { StaffActor } from "../middleware/auth.js";
import type { CourseInput, academicQuery } from "../validation/academic.validation.js";
import { HttpError } from "../utils/http-error.js";
import { courseSelect, projectCourse } from "./academic.projection.js";

async function uniqueCode<T>(operation: () => Promise<T>) {
  try { return await operation(); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new HttpError(409, "Course code is already in use");
    throw error;
  }
}
export async function listCourses(query: ReturnType<typeof academicQuery>, actor: StaffActor) {
  const where: Prisma.CourseWhereInput = actor.role === "ADMIN" ? {} : { sections: { some: { lecturerId: actor.id } } };
  return prisma.$transaction(async tx => {
    const total = await tx.course.count({ where });
    const rows = await tx.course.findMany({ where, select: courseSelect, orderBy: [{ code: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.limit, take: query.limit });
    return { courses: rows.map(projectCourse), pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
export async function createCourse(input: CourseInput, actorId: string) {
  return uniqueCode(() => prisma.$transaction(async tx => {
    const { name: title, ...rest } = input;
    const course = await tx.course.create({ data: { ...rest, title }, select: courseSelect });
    await tx.auditEntry.create({ data: { actorId, courseId: course.id, action: "COURSE_CREATED", details: { profile: input } } });
    return projectCourse(course);
  }));
}
export async function updateCourse(id: number, input: Partial<CourseInput>, actorId: string) {
  return uniqueCode(() => prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Course" WHERE "id" = ${id} FOR UPDATE`;
    const row = await tx.course.findUnique({ where: { id }, select: courseSelect });
    if (!row) throw new HttpError(404, "Course not found");
    const before = projectCourse(row);
    const changedFields = (Object.keys(input) as (keyof CourseInput)[]).filter(key => before[key] !== input[key]);
    if (!changedFields.length) return before;
    const { name: title, ...rest } = input;
    const course = projectCourse(await tx.course.update({ where: { id }, data: { ...rest, ...(title === undefined ? {} : { title }) }, select: courseSelect }));
    await tx.auditEntry.create({ data: { actorId, courseId: id, action: "COURSE_UPDATED", details: { changedFields,
      before: Object.fromEntries(changedFields.map(key => [key, before[key]])), after: Object.fromEntries(changedFields.map(key => [key, course[key]])) } } });
    return course;
  }));
}
