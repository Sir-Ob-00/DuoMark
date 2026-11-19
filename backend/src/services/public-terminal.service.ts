import { prisma } from "../db/prisma.js";
import { HttpError } from "../utils/http-error.js";

export async function getPublicTerminalSession(id: string) {
  // Deliberately separate from the admin projection: neither private relations
  // nor availability belong in the public display's readiness decision.
  const station = await prisma.terminal.findUnique({ where: { id }, select: {
    id: true, name: true, location: true,
    attendanceSessions: { where: { status: "OPEN" }, take: 1,
      orderBy: [{ openedAt: "desc" }, { id: "desc" }],
      select: { id: true, sectionCode: true, courseCode: true, courseName: true } },
  } });
  if (!station) throw new HttpError(404, "Terminal not found");
  return { terminal: { id: station.id, name: station.name, location: station.location },
    activeSession: station.attendanceSessions[0] ?? null };
}
