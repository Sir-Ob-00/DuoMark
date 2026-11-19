import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { HttpError } from "../utils/http-error.js";
import { lockTerminalForNewSession } from "./terminal.service.js";
import { projectSession, projectSessionRegister, sessionSummarySelect } from "./session.projection.js";
import { readAuthorizedSessionRegister } from "./attendance-read.service.js";
import { publishChange } from "./events.service.js";
import type { openSessionInput, sessionQuery } from "../validation/session.validation.js";

export async function listSessions(lecturerId: string, query: ReturnType<typeof sessionQuery>) {
  const where: Prisma.AttendanceSessionWhereInput = { lecturerId,
    ...(query.view === "all" ? {} : { status: query.view === "active" ? "OPEN" : "CLOSED" }) };
  return readSessionPage(where, query);
}
// Callers must construct the role-appropriate scope before using this shared reader.
export async function readSessionPage(where: Prisma.AttendanceSessionWhereInput, query: { page: number; limit: number }) {
  return prisma.$transaction(async tx => {
    const total = await tx.attendanceSession.count({ where });
    const sessions = await tx.attendanceSession.findMany({ where, select: sessionSummarySelect,
      orderBy: [{ openedAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.limit, take: query.limit });
    return { sessions: sessions.map(projectSession), pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
export async function openSession(input: ReturnType<typeof openSessionInput>, lecturerId: string) {
  try {
    const committed = await prisma.$transaction(async tx => {
      // Lock order: section -> terminal -> staff. Assignment and availability
      // setters lock these same rows, and locks are held through insertion/audit.
      await tx.$queryRaw`SELECT "id" FROM "ClassSection" WHERE "id" = ${input.sectionId} FOR UPDATE`;
      const section = await tx.classSection.findUnique({ where: { id: input.sectionId }, include: { course: true } });
      if (!section) throw new HttpError(404, "Class section not found");
      if (section.lecturerId !== lecturerId) throw new HttpError(403, "You are not assigned to this class section");
      await lockTerminalForNewSession(tx, input.terminalId);
      await tx.$queryRaw`SELECT "id" FROM "Staff" WHERE "id" = ${lecturerId} FOR UPDATE`;
      if (!await tx.staff.findFirst({ where: { id: lecturerId, role: "LECTURER", status: "Active" }, select: { id: true } })) throw new HttpError(401, "Authentication required");
      if (await tx.attendanceSession.findFirst({ where: { terminalId: input.terminalId, status: "OPEN" }, select: { id: true } })) throw new HttpError(409, "Terminal already has an open session");
      const session = await tx.attendanceSession.create({ data: { ...input, lecturerId, courseId: section.courseId,
        courseCode: section.course.code, courseName: section.course.title, sectionCode: section.code, room: section.room,
        academicYear: section.academicYear, term: section.term, openedAt: new Date() }, select: sessionSummarySelect });
      await tx.auditEntry.create({ data: { actorId: lecturerId, attendanceSessionId: session.id, action: "SESSION_OPENED",
        details: { sectionId: section.id, terminalId: input.terminalId, openedAt: session.openedAt.toISOString() } } });
      return projectSession(session);
    });
    publishChange({ type: "session-opened", sessionId: committed.id, terminalId: committed.terminalId });
    return committed;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new HttpError(409, "Terminal already has an open session");
    throw error;
  }
}
export async function getSession(id: string, lecturerId: string) {
  const { session } = await readAuthorizedSessionRegister({ id, lecturerId });
  // Read the official register, never infer attendance from the current roster.
  return projectSessionRegister(session);
}
export async function closeSession(id: string, lecturerId: string) {
  const committed = await prisma.$transaction(async tx => {
    // Fingerprint completion acquires this SAME row lock and rechecks OPEN
    // inside the insert transaction. Closing does not check terminal availability.
    await tx.$queryRaw`SELECT "id" FROM "AttendanceSession" WHERE "id" = ${id} AND "lecturerId" = ${lecturerId} FOR UPDATE`;
    const before = await tx.attendanceSession.findFirst({ where: { id, lecturerId }, select: sessionSummarySelect });
    if (!before) throw new HttpError(404, "Attendance session not found");
    if (before.status === "CLOSED") return { session: projectSession(before), changed: false };
    const closedAt = new Date(Math.max(Date.now(), before.openedAt.getTime()));
    const session = await tx.attendanceSession.update({ where: { id }, data: { status: "CLOSED", closedAt }, select: sessionSummarySelect });
    await tx.auditEntry.create({ data: { actorId: lecturerId, attendanceSessionId: id, action: "SESSION_CLOSED",
      details: { sectionId: before.sectionId, terminalId: before.terminalId, closedAt: closedAt.toISOString() } } });
    return { session: projectSession(session), changed: true };
  });
  if (committed.changed) publishChange({ type: "session-closed", sessionId: id, terminalId: committed.session.terminalId });
  return committed.session;
}
