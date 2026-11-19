import { HttpError } from "../utils/http-error.js";

export const ACADEMIC_TIME_ZONE = "UTC";
function calendarDate(value: unknown, field: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) throw new HttpError(400, `${field} must be a calendar date in YYYY-MM-DD format (UTC)`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new HttpError(400, `${field} must be a real calendar date`);
  return date;
}
export function calendarDateRange(from: unknown, to: unknown) {
  const dateFrom = from === undefined ? undefined : calendarDate(from, "dateFrom");
  const dateTo = to === undefined ? undefined : calendarDate(to, "dateTo");
  if (dateFrom && dateTo && dateFrom.getTime() > dateTo.getTime()) throw new HttpError(400, "dateFrom must be on or before dateTo");
  return { dateFrom, dateToExclusive: dateTo ? new Date(dateTo.getTime() + 86400000) : undefined };
}
