import { HttpError } from "../utils/http-error.js";
import { lecturerId } from "./lecturer.validation.js";
import { sectionId } from "./academic.validation.js";
import { calendarDateRange } from "./calendar-date.validation.js";

// The frontend derives academic calendar dates with toISOString (UTC).
// Calendar boundaries must not depend on the host/browser local timezone.
export { ACADEMIC_TIME_ZONE as SESSION_CALENDAR_TIME_ZONE } from "./calendar-date.validation.js";
export function adminSessionQuery(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Invalid query parameters");
  const query = value as Record<string, unknown>;
  if (Object.keys(query).some(key => !["page", "limit", "lecturerId", "sectionId", "dateFrom", "dateTo", "status"].includes(key))) {
    throw new HttpError(400, "Unsupported session query fields");
  }
  function integer(key: string, fallback: number, maximum: number) {
    if (query[key] === undefined) return fallback;
    if (typeof query[key] !== "string" || !/^[1-9][0-9]*$/.test(query[key])) throw new HttpError(400, `${key} must be a positive integer`);
    const number = Number(query[key]);
    if (!Number.isSafeInteger(number) || number > maximum) throw new HttpError(400, `${key} must be between 1 and ${maximum}`);
    return number;
  }
  const { dateFrom, dateToExclusive } = calendarDateRange(query.dateFrom, query.dateTo);
  const status = query.status;
  if (status !== undefined && status !== "Open" && status !== "Closed") throw new HttpError(400, "status must be Open or Closed");
  return { page: integer("page", 1, 10000), limit: integer("limit", 20, 100),
    lecturerId: query.lecturerId === undefined ? undefined : lecturerId(query.lecturerId),
    sectionId: query.sectionId === undefined ? undefined : sectionId(query.sectionId), status,
    dateFrom, dateToExclusive };
}
