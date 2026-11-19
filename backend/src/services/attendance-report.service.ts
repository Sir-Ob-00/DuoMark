import type { Prisma } from "../generated/prisma/client.js";
import type { StaffActor } from "../middleware/auth.js";
import type { attendanceReportQuery } from "../validation/attendance-report.validation.js";
import { ACADEMIC_TIME_ZONE } from "../validation/calendar-date.validation.js";
import { attendanceRecordFilters, readAttendancePage } from "./attendance-read.service.js";

export function attendanceReportWhere(query: ReturnType<typeof attendanceReportQuery>, actor: StaffActor): Prisma.AttendanceRecordWhereInput {
  const authorization: Prisma.AttendanceRecordWhereInput = actor.role === "ADMIN" ? {} : {
    session: { lecturerId: actor.id, status: "CLOSED", section: { lecturerId: actor.id } },
  };
  const openerFilter: Prisma.AttendanceRecordWhereInput = actor.role === "ADMIN" && query.lecturerId ? { session: { lecturerId: query.lecturerId } } : {};
  // Assignment, lifecycle, original ownership, and requested filters intersect in
  // SQL before counting/pagination. No client identity can replace this scope.
  return { AND: [authorization, attendanceRecordFilters(query), openerFilter] };
}
export async function attendanceReport(query: ReturnType<typeof attendanceReportQuery>, actor: StaffActor) {
  const result = await readAttendancePage(attendanceReportWhere(query, actor), query, true);
  return { ...result, metadata: { academicTimeZone: ACADEMIC_TIME_ZONE, dateField: "recordedAt",
    scope: actor.role === "ADMIN" ? "all-official-attendance" : "closed-owned-currently-assigned-sections" } };
}
