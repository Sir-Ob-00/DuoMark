import { AuditAction } from "../generated/prisma/client.js";
import { calendarDateRange } from "./calendar-date.validation.js";
import { terminalId } from "./terminal.validation.js";
import { courseId } from "./academic.validation.js";
import { HttpError } from "../utils/http-error.js";

export const targetTypes = ["student", "lecturer", "course", "section", "terminal", "session", "attendance-record", "report"] as const;
export type AuditTargetType = typeof targetTypes[number];
export function auditUuid(value: unknown, field = "eventId") {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new HttpError(400, `${field} must be a UUID`);
  return value;
}
export function auditQuery(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Invalid audit query");
  const query = value as Record<string, unknown>;
  const keys = ["page", "limit", "search", "eventType", "action", "actor", "actorId", "actorType", "target", "targetId", "targetType", "dateFrom", "dateTo"];
  if (Object.keys(query).some(key => !keys.includes(key))) throw new HttpError(400, "Unsupported audit query fields");
  function integer(key: string, fallback: number, max: number) {
    if (query[key] === undefined) return fallback;
    if (typeof query[key] !== "string" || !/^[1-9][0-9]*$/.test(query[key]) || !Number.isSafeInteger(Number(query[key])) || Number(query[key]) > max) throw new HttpError(400, `${key} must be an integer from 1 to ${max}`);
    return Number(query[key]);
  }
  function text(key: string) {
    if (query[key] === undefined) return undefined;
    const input = query[key];
    if (typeof input !== "string" || !input.trim() || input.trim().length > 200 || /[\u0000-\u001f\u007f]/.test(input)) throw new HttpError(400, `${key} must be non-empty text of at most 200 characters`);
    return input.trim();
  }
  const eventType = query.eventType;
  if (eventType !== undefined && (typeof eventType !== "string" || !Object.values(AuditAction).includes(eventType as AuditAction))) throw new HttpError(400, "eventType must be a supported audit event type");
  const actorType = query.actorType;
  if (actorType !== undefined && actorType !== "staff" && actorType !== "device") throw new HttpError(400, "actorType must be staff or device");
  const targetType = query.targetType;
  if (targetType !== undefined && !targetTypes.includes(targetType as AuditTargetType)) throw new HttpError(400, "Invalid audit targetType");
  if (query.targetId !== undefined && targetType === undefined) throw new HttpError(400, "targetType is required with targetId");
  if (targetType === "report" && query.targetId !== undefined && query.targetId !== "attendance") throw new HttpError(400, "Report targetId must be attendance");
  const targetId = query.targetId === undefined ? undefined : targetType === "report" ? "attendance" : targetType === "course" ? courseId(query.targetId) : targetType === "terminal" ? terminalId(query.targetId) : auditUuid(query.targetId, "targetId");
  return { page: integer("page", 1, 10000), limit: integer("limit", 20, 100), search: text("search"), action: text("action"), actor: text("actor"), target: text("target"),
    eventType: eventType as AuditAction | undefined, actorType: actorType as "staff" | "device" | undefined,
    actorId: query.actorId === undefined ? undefined : auditUuid(query.actorId, "actorId"),
    targetType: targetType as AuditTargetType | undefined, targetId, ...calendarDateRange(query.dateFrom, query.dateTo) };
}
