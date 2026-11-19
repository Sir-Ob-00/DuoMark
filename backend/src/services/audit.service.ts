import { prisma } from "../db/prisma.js";
import { Prisma, type AuditAction } from "../generated/prisma/client.js";
import type { auditQuery, AuditTargetType } from "../validation/audit.validation.js";
import { HttpError } from "../utils/http-error.js";
import { approvedAuditMetadata, auditLabels, auditSummarySelect, projectAuditSummary } from "./audit.projection.js";

const contains = (value: string) => ({ contains: value, mode: "insensitive" as const });
const actionMatches = (value: string) => (Object.keys(auditLabels) as AuditAction[]).filter(action => `${action} ${auditLabels[action]}`.toLowerCase().includes(value.toLowerCase()));
function actorMatches(value: string): Prisma.AuditEntryWhereInput {
  return { OR: [{ actor: { name: contains(value) } }, { actorId: contains(value) }, { deviceActorId: contains(value) }, { deviceActor: { terminal: { name: contains(value) } } }] };
}
function targetMatches(value: string): Prisma.AuditEntryWhereInput {
  const numeric = /^[1-9][0-9]*$/.test(value) && Number(value) <= 2147483647 ? Number(value) : undefined;
  return { OR: [
    ...("attendance report".includes(value.toLowerCase()) ? [{ reportId: "attendance" }] : []),
    ...["studentId", "lecturerId", "sectionId", "terminalId", "attendanceSessionId", "attendanceRecordId"].map(key => ({ [key]: contains(value) })),
    ...(numeric ? [{ courseId: numeric }] : []),
    { student: { OR: [{ name: contains(value) }, { studentId: contains(value) }] } }, { lecturer: { name: contains(value) } },
    { course: { OR: [{ code: contains(value) }, { title: contains(value) }] } },
    { section: { OR: [{ code: contains(value) }, { academicYear: contains(value) }, { term: contains(value) }, { course: { code: contains(value) } }] } },
    { terminal: { name: contains(value) } }, { attendanceSession: { OR: [{ courseCode: contains(value) }, { sectionCode: contains(value) }] } },
    { attendanceRecord: { OR: [{ studentIndexNumber: contains(value) }, { studentName: contains(value) }] } },
  ] };
}
function targetFilter(type: AuditTargetType, id?: string | number): Prisma.AuditEntryWhereInput {
  if (type === "report") return { reportId: "attendance" };
  if (type === "course") return { courseId: id === undefined ? { not: null } : Number(id) };
  const key = { student: "studentId", lecturer: "lecturerId", section: "sectionId", terminal: "terminalId", session: "attendanceSessionId", "attendance-record": "attendanceRecordId" }[type];
  return { [key]: id === undefined ? { not: null } : String(id) };
}
export async function listAuditEvents(query: ReturnType<typeof auditQuery>) {
  const and: Prisma.AuditEntryWhereInput[] = [];
  if (query.eventType) and.push({ action: query.eventType });
  if (query.action) and.push({ action: { in: actionMatches(query.action) } });
  if (query.actorType === "staff") and.push({ actorId: { not: null } });
  if (query.actorType === "device") and.push({ deviceActorId: { not: null } });
  if (query.actorId) and.push({ OR: [{ actorId: query.actorId }, { deviceActorId: query.actorId }] });
  if (query.actor) and.push(actorMatches(query.actor));
  if (query.targetType) and.push(targetFilter(query.targetType, query.targetId));
  if (query.target) and.push(targetMatches(query.target));
  if (query.search) and.push({ OR: [{ action: { in: actionMatches(query.search) } }, actorMatches(query.search), targetMatches(query.search)] });
  if (query.dateFrom || query.dateToExclusive) and.push({ timestamp: { gte: query.dateFrom, lt: query.dateToExclusive } });
  const where: Prisma.AuditEntryWhereInput = { AND: and };
  return prisma.$transaction(async tx => {
    const total = await tx.auditEntry.count({ where });
    const rows = await tx.auditEntry.findMany({ where, select: auditSummarySelect, orderBy: [{ timestamp: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.limit, take: query.limit });
    return { auditEvents: rows.map(projectAuditSummary), pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
export async function getAuditEvent(id: string) {
  const row = await prisma.auditEntry.findUnique({ where: { id }, select: { ...auditSummarySelect, details: true } });
  if (!row) throw new HttpError(404, "Audit event not found");
  return { ...projectAuditSummary(row), metadata: approvedAuditMetadata(row.action, row.details) };
}
