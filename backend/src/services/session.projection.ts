import type { Prisma } from "../generated/prisma/client.js";

export const sessionSummarySelect = { id: true, lecturerId: true, sectionId: true, terminalId: true, courseId: true,
  courseCode: true, courseName: true, sectionCode: true, room: true, academicYear: true, term: true,
  status: true, openedAt: true, closedAt: true } as const;
export const attendanceRecordSelect = { id: true, sessionId: true, studentId: true, studentIndexNumber: true, studentName: true, recordedAt: true, developmentOnly: true } as const;
export function projectAttendanceRecord(record: Prisma.AttendanceRecordGetPayload<{ select: typeof attendanceRecordSelect }>) {
  return { id: record.id, sessionId: record.sessionId, studentId: record.studentId, indexNumber: record.studentIndexNumber,
    studentName: record.studentName, recordedAt: record.recordedAt, status: "Present", developmentOnly: record.developmentOnly };
}
export const sessionRegisterSelect = { ...sessionSummarySelect, attendanceRecords: {
  select: attendanceRecordSelect,
  orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
} } satisfies Prisma.AttendanceSessionSelect;
export function projectSession(session: Prisma.AttendanceSessionGetPayload<{ select: typeof sessionSummarySelect }>) {
  return { ...session, status: session.status === "OPEN" ? "Open" as const : "Closed" as const,
    startsAt: session.openedAt, date: session.openedAt.toISOString().slice(0, 10) };
}

export function projectSessionRegister(session: Prisma.AttendanceSessionGetPayload<{ select: typeof sessionRegisterSelect }>) {
  const { attendanceRecords, ...summary } = session;
  return { ...projectSession(summary), attendance: attendanceRecords.map(projectAttendanceRecord) };
}
