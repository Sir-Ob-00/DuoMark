import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import type { StaffActor } from "../middleware/auth.js";
import type { attendanceQuery } from "../validation/attendance-read.validation.js";
import { HttpError } from "../utils/http-error.js";
import { attendanceRecordSelect, projectAttendanceRecord, projectSessionRegister, sessionRegisterSelect } from "./session.projection.js";

// Shared database reader used by both existing detail views and the standalone
// register. Callers supply an ADMIN or original-opening-lecturer scope.
export async function readAuthorizedSessionRegister(where: Prisma.AttendanceSessionWhereInput) {
  const row = await prisma.attendanceSession.findFirst({ where, select: { ...sessionRegisterSelect,
    lecturer: { select: { id: true, name: true, email: true } },
    terminal: { select: { id: true, name: true, location: true, status: true } },
  } });
  if (!row) throw new HttpError(404, "Attendance session not found");
  const { lecturer, terminal, ...session } = row;
  return { session, lecturer, terminal };
}
export async function getSessionAttendance(id: string, actor: StaffActor) {
  const scope: Prisma.AttendanceSessionWhereInput = actor.role === "ADMIN" ? {} : { lecturerId: actor.id };
  const { session } = await readAuthorizedSessionRegister({ AND: [{ id }, scope] });
  return { sessionId: session.id, attendance: projectSessionRegister(session).attendance };
}
export async function listAttendanceRecords(query: ReturnType<typeof attendanceQuery>, actor: StaffActor) {
  const authorization = attendanceHistoryScope(actor);
  return readAttendancePage({ AND: [authorization, attendanceRecordFilters(query)] }, query);
}
// Overview activity follows history (includes open sessions and previous
// assignments), rather than the narrower closed/current-assignment reports.
export function attendanceHistoryScope(actor: Pick<StaffActor, "id" | "role">): Prisma.AttendanceRecordWhereInput {
  return actor.role === "ADMIN" ? {} : { session: { lecturerId: actor.id } };
}
export function attendanceRecordFilters(query: ReturnType<typeof attendanceQuery>): Prisma.AttendanceRecordWhereInput {
  return { sessionId: query.sessionId, studentId: query.studentId,
    // These are the immutable session references, not today's section catalog or lecturer.
    session: { sectionId: query.sectionId, courseId: query.courseId },
    ...(query.dateFrom || query.dateToExclusive ? { recordedAt: { gte: query.dateFrom, lt: query.dateToExclusive } } : {}) };
}
// All report/read callers must intersect their server-owned scope before calling.
export async function readAttendancePage(where: Prisma.AttendanceRecordWhereInput, query: { page: number; limit: number }, includeLecturerName = false) {
  return prisma.$transaction(async tx => {
    const total = await tx.attendanceRecord.count({ where });
    const records = await tx.attendanceRecord.findMany({ where, select: { ...attendanceRecordSelect,
      session: { select: { sectionId: true, courseId: true, lecturerId: true, courseCode: true, courseName: true, sectionCode: true,
        lecturer: { select: { name: true } } } },
    }, orderBy: [{ recordedAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.limit, take: query.limit });
    return { attendanceRecords: records.map(({ session: { lecturer, ...session }, ...record }) => ({ ...projectAttendanceRecord(record), ...session,
      ...(includeLecturerName ? { lecturerName: lecturer.name } : {}) })),
      pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
