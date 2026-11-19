import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import type { academicQuery } from "../validation/academic.validation.js";
import { projectRoster, projectSection, sectionSelect } from "./academic.projection.js";
import { projectSession, sessionSummarySelect } from "./session.projection.js";

// Current assignment scopes classes; original opener scopes session history.
export const RECENT_SESSIONS_PER_SECTION = 10;
export async function myClasses(lecturerId: string, query: Pick<ReturnType<typeof academicQuery>, "page" | "limit">) {
  return prisma.$transaction(async tx => {
    // lecturerId comes exclusively from request.actor, never query/body input.
    const where = { lecturerId };
    const total = await tx.classSection.count({ where });
    const sections = await tx.classSection.findMany({ where, select: { ...sectionSelect, attendanceSessions: {
      where: { lecturerId }, orderBy: [{ openedAt: "desc" }, { id: "desc" }], take: RECENT_SESSIONS_PER_SECTION, select: sessionSummarySelect } },
      orderBy: [{ academicYear: "desc" }, { term: "asc" }, { code: "asc" }, { id: "asc" }],
      skip: (query.page - 1) * query.limit, take: query.limit });
    return { classes: sections.map(({ attendanceSessions, ...section }) => ({ ...projectSection(section), courseCode: section.course.code,
      courseName: section.course.title, students: projectRoster(section), recentSessions: attendanceSessions.map(projectSession) })),
      pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
