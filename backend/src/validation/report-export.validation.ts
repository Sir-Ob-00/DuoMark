import { HttpError } from "../utils/http-error.js";
import { attendanceReportQuery } from "./attendance-report.validation.js";
import { auditUuid } from "./audit.validation.js";

export function reportExportInput(value: unknown, admin: boolean) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Expected a JSON object");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !["reportId", "filters", "requestId"].includes(key))) throw new HttpError(400, "Only reportId, filters and requestId are accepted");
  if (body.reportId !== "attendance") throw new HttpError(400, "Unsupported reportId; use attendance");
  if (!body.filters || typeof body.filters !== "object" || Array.isArray(body.filters)) throw new HttpError(400, "filters must be an object");
  const filters = body.filters as Record<string, unknown>;
  if (Object.keys(filters).some(key => !["courseId", "sectionId", "dateFrom", "dateTo", ...(admin ? ["lecturerId"] : [])].includes(key))) throw new HttpError(400, "Unsupported report filters");
  const query = attendanceReportQuery(filters, admin);
  // Fixed order/normalized IDs ensures equivalent retries hash identically.
  const normalized = {
    ...(query.courseId === undefined ? {} : { courseId: query.courseId }),
    ...(query.sectionId === undefined ? {} : { sectionId: query.sectionId }),
    ...(query.lecturerId === undefined ? {} : { lecturerId: query.lecturerId }),
    ...(query.dateFrom ? { dateFrom: query.dateFrom.toISOString().slice(0, 10) } : {}),
    ...(filters.dateTo === undefined ? {} : { dateTo: filters.dateTo as string }),
  };
  return { reportId: "attendance" as const, requestId: auditUuid(body.requestId, "requestId").toLowerCase(), query, filters: normalized };
}
