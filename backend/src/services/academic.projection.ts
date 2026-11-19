import type { Prisma } from "../generated/prisma/client.js";

export const courseSelect = { id: true, code: true, title: true, department: true } as const;
export const rosterStudentSelect = { id: true, studentId: true, name: true } as const;
export const sectionSelect = { id: true, code: true, courseId: true, lecturerId: true, room: true, schedule: true, academicYear: true, term: true,
  rosterMemberships: { select: { student: { select: rosterStudentSelect } }, orderBy: [{ student: { name: "asc" } }, { studentId: "asc" }] },
  course: { select: courseSelect }, lecturer: { select: { id: true, name: true, email: true, role: true, status: true } } } satisfies Prisma.ClassSectionSelect;
export function projectCourse(course: Prisma.CourseGetPayload<{ select: typeof courseSelect }>) {
  return { id: course.id, code: course.code, name: course.title, department: course.department };
}
export function projectSection(section: Prisma.ClassSectionGetPayload<{ select: typeof sectionSelect }>) {
  const { rosterMemberships, ...fields } = section;
  return { ...fields, course: projectCourse(section.course), studentIds: rosterMemberships.map(member => member.student.id) };
}
export function projectRoster(section: Prisma.ClassSectionGetPayload<{ select: typeof sectionSelect }>) {
  return section.rosterMemberships.map(member => member.student);
}
