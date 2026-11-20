import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { ACADEMIC_TIME_ZONE, calendarDateRange } from "../validation/calendar-date.validation.js";
import { attendanceHistoryScope } from "./attendance-read.service.js";

function todayContext(now: Date) {
  const today = now.toISOString().slice(0, 10);
  const range = calendarDateRange(today, today);
  return { context: { academicTimeZone: ACADEMIC_TIME_ZONE, today }, recordedAt: { gte: range.dateFrom, lt: range.dateToExclusive } };
}
export async function adminOverview(now = new Date()) {
  const { context, recordedAt } = todayContext(now);
  return prisma.$transaction(async tx => {
    const studentProfiles = await tx.student.count();
    const lecturers = await tx.staff.count({ where: { role: "LECTURER" } });
    const faceEnrolledStudents = await tx.student.count({ where: { faceEnrollment: "Enrolled" } });
    const fingerprintEnrolledStudents = await tx.student.count({ where: { fingerprintEnrollment: "Enrolled" } });
    const openSessions = await tx.attendanceSession.count({ where: { status: "OPEN" } });
    const totalSessions = await tx.attendanceSession.count();
    const availableTerminals = await tx.terminal.count({ where: { status: "Available" } });
    const totalTerminals = await tx.terminal.count();
    const attendanceRecords = await tx.attendanceRecord.count();
    const checkInsToday = await tx.attendanceRecord.count({ where: { recordedAt } });
    return { counts: { studentProfiles, lecturers, faceEnrolledStudents, fingerprintEnrolledStudents, openSessions, totalSessions, availableTerminals, totalTerminals, attendanceRecords, checkInsToday }, context };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
export async function lecturerOverview(lecturerId: string, now = new Date()) {
  const { context, recordedAt } = todayContext(now);
  const scope = attendanceHistoryScope({ id: lecturerId, role: "LECTURER" });
  return prisma.$transaction(async tx => {
    const assignedClasses = await tx.classSection.count({ where: { lecturerId } });
    const openSessions = await tx.attendanceSession.count({ where: { lecturerId, status: "OPEN" } });
    const totalSessions = await tx.attendanceSession.count({ where: { lecturerId } });
    const attendanceRecords = await tx.attendanceRecord.count({ where: scope });
    const checkInsToday = await tx.attendanceRecord.count({ where: { AND: [scope, { recordedAt }] } });
    return { counts: { assignedClasses, openSessions, totalSessions, attendanceRecords, checkInsToday }, context };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
