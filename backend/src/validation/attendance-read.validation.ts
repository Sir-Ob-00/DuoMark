import { HttpError } from "../utils/http-error.js";
import { sessionId } from "./session.validation.js";
import { courseId, sectionId } from "./academic.validation.js";
import { studentPathId } from "./student.validation.js";
import { calendarDateRange } from "./calendar-date.validation.js";

export function attendanceQuery(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Invalid query parameters");
  const query = value as Record<string, unknown>;
  if (Object.keys(query).some(key => !["page", "limit", "sessionId", "sectionId", "courseId", "studentId", "dateFrom", "dateTo"].includes(key))) throw new HttpError(400, "Unsupported attendance query fields");
  function integer(key: string, fallback: number, maximum: number) {
    if (query[key] === undefined) return fallback;
    if (typeof query[key] !== "string" || !/^[1-9][0-9]*$/.test(query[key])) throw new HttpError(400, `${key} must be a positive integer`);
    const number = Number(query[key]);
    if (!Number.isSafeInteger(number) || number > maximum) throw new HttpError(400, `${key} must be between 1 and ${maximum}`);
    return number;
  }
  return { page: integer("page", 1, 10000), limit: integer("limit", 20, 100),
    sessionId: query.sessionId === undefined ? undefined : sessionId(query.sessionId),
    sectionId: query.sectionId === undefined ? undefined : sectionId(query.sectionId),
    courseId: query.courseId === undefined ? undefined : courseId(query.courseId),
    studentId: query.studentId === undefined ? undefined : studentPathId(query.studentId),
    ...calendarDateRange(query.dateFrom, query.dateTo) };
}
