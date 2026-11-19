import type { Prisma } from "../generated/prisma/client.js";
import type { adminSessionQuery } from "../validation/admin-session.validation.js";
import { readSessionPage } from "./attendance-session.service.js";
import { projectSessionRegister } from "./session.projection.js";
import { readAuthorizedSessionRegister } from "./attendance-read.service.js";

export async function listAdminSessions(query: ReturnType<typeof adminSessionQuery>) {
  const where: Prisma.AttendanceSessionWhereInput = { lecturerId: query.lecturerId, sectionId: query.sectionId,
    ...(query.status ? { status: query.status === "Open" ? "OPEN" : "CLOSED" } : {}),
    ...(query.dateFrom || query.dateToExclusive ? { openedAt: { gte: query.dateFrom, lt: query.dateToExclusive } } : {}) };
  return readSessionPage(where, query);
}
export async function getAdminSession(id: string) {
  const { session, lecturer, terminal } = await readAuthorizedSessionRegister({ id });
  return { ...projectSessionRegister(session), lecturer, terminal,
    // Use the opening snapshots rather than today's mutable catalog/assignment.
    section: { id: session.sectionId, code: session.sectionCode, courseId: session.courseId,
      room: session.room, academicYear: session.academicYear, term: session.term },
    course: { id: session.courseId, code: session.courseCode, name: session.courseName },
  };
}
