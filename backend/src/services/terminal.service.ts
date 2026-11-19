import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import type { TerminalInput, TerminalProfile, terminalQuery } from "../validation/terminal.validation.js";
import { HttpError } from "../utils/http-error.js";
import { projectSession, sessionSummarySelect } from "./session.projection.js";

const terminalSelect = { id: true, name: true, location: true, status: true,
  attendanceSessions: { where: { status: "OPEN" }, take: 1, select: sessionSummarySelect, orderBy: { openedAt: "desc" } } } satisfies Prisma.TerminalSelect;
function projectTerminal(terminal: Prisma.TerminalGetPayload<{ select: typeof terminalSelect }>) {
  const { attendanceSessions, ...station } = terminal;
  const activeSession = attendanceSessions[0] ? projectSession(attendanceSessions[0]) : null;
  return { ...station, sessionId: activeSession?.id ?? null, activeSession };
}
async function lockTerminal(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "Terminal" WHERE "id" = ${id} FOR UPDATE`;
  const terminal = await tx.terminal.findUnique({ where: { id }, select: terminalSelect });
  if (!terminal) throw new HttpError(404, "Terminal not found");
  return terminal;
}
// Session opening calls this inside its creation transaction and keeps the
// lock through insertion; the session service also checks terminal occupancy.
// Closing/continuing an already-open session must not call this availability guard.
export async function lockTerminalForNewSession(tx: Prisma.TransactionClient, id: string) {
  const terminal = await lockTerminal(tx, id);
  if (terminal.status !== "Available") throw new HttpError(409, "Terminal is unavailable for new sessions");
  return terminal;
}
export async function listTerminals(query: ReturnType<typeof terminalQuery>) {
  const where: Prisma.TerminalWhereInput = { status: query.status };
  if (query.search) where.OR = ["id", "name", "location"].map(field => ({ [field]: { contains: query.search, mode: "insensitive" } }));
  return prisma.$transaction(async tx => {
    const total = await tx.terminal.count({ where });
    const rows = await tx.terminal.findMany({ where, select: terminalSelect, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.limit, take: query.limit });
    return { terminals: rows.map(projectTerminal), pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
export async function getTerminal(id: string) {
  const terminal = await prisma.terminal.findUnique({ where: { id }, select: terminalSelect });
  if (!terminal) throw new HttpError(404, "Terminal not found");
  return projectTerminal(terminal);
}
export async function createTerminal(input: TerminalInput, actorId: string) {
  try {
    return await prisma.$transaction(async tx => {
      const terminal = await tx.terminal.create({ data: { ...input, status: "Available" }, select: terminalSelect });
      await tx.auditEntry.create({ data: { actorId, terminalId: terminal.id, action: "TERMINAL_REGISTERED", details: { profile: input, status: "Available" } } });
      return projectTerminal(terminal);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new HttpError(409, "Terminal ID is already registered");
    throw error;
  }
}
export async function updateTerminal(id: string, input: Partial<TerminalProfile>, actorId: string) {
  return prisma.$transaction(async tx => {
    const before = await lockTerminal(tx, id);
    const changedFields = (Object.keys(input) as (keyof TerminalProfile)[]).filter(key => input[key] !== before[key]);
    if (!changedFields.length) return projectTerminal(before);
    const terminal = await tx.terminal.update({ where: { id }, data: input, select: terminalSelect });
    await tx.auditEntry.create({ data: { actorId, terminalId: id, action: "TERMINAL_UPDATED", details: { changedFields,
      before: Object.fromEntries(changedFields.map(key => [key, before[key]])), after: Object.fromEntries(changedFields.map(key => [key, terminal[key]])) } } });
    return projectTerminal(terminal);
  });
}
export async function setTerminalAvailability(id: string, status: "Available" | "Unavailable", actorId: string) {
  return prisma.$transaction(async tx => {
    const before = await lockTerminal(tx, id);
    if (before.status === status) return projectTerminal(before);
    // Availability affects only future openings. Never close a session here.
    const terminal = await tx.terminal.update({ where: { id }, data: { status }, select: terminalSelect });
    await tx.auditEntry.create({ data: { actorId, terminalId: id, action: "TERMINAL_AVAILABILITY_CHANGED", details: { before: before.status, after: status } } });
    return projectTerminal(terminal);
  });
}
