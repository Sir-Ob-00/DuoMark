import { HttpError } from "../utils/http-error.js";
import { attendanceQuery } from "./attendance-read.validation.js";
import { lecturerId } from "./lecturer.validation.js";

export function attendanceReportQuery(value: unknown, admin: boolean) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Invalid query parameters");
  const query = value as Record<string, unknown>;
  const allowed = ["page", "limit", "courseId", "sectionId", "dateFrom", "dateTo", ...(admin ? ["lecturerId"] : [])];
  if (Object.keys(query).some(key => !allowed.includes(key))) throw new HttpError(400, "Unsupported attendance report query fields");
  const { lecturerId: openingLecturer, ...base } = query;
  return { ...attendanceQuery(base), lecturerId: openingLecturer === undefined ? undefined : lecturerId(openingLecturer) };
}
