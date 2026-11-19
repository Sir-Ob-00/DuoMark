import { HttpError } from "../utils/http-error.js";
import { lecturerId } from "./lecturer.validation.js";

export type CourseInput = { code: string; name: string; department: string };
export type SectionInput = { code: string; courseId: number; lecturerId: string; room: string; schedule: string; academicYear: string; term: string };
function invalid(message: string): never { throw new HttpError(400, message); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Expected a JSON object");
  return value as Record<string, unknown>;
}
function onlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(value).some(key => !keys.includes(key))) invalid("Request contains unsupported fields");
}
function text(value: unknown, field: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) invalid(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}
function code(value: unknown, field: string, max: number) {
  const result = text(value, field, max).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 ./_-]*$/.test(result)) invalid(`${field} must start with a letter/digit and use letters, digits, spaces, ., /, _ or -`);
  return result;
}
export function courseId(value: unknown) {
  if (typeof value !== "number" && (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value))) invalid("courseId must be a positive integer");
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) invalid("courseId must be a positive PostgreSQL integer");
  return id;
}
export function sectionId(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) invalid("sectionId must be a UUID");
  return value;
}
function academicYear(value: unknown) {
  const year = text(value, "academicYear", 9);
  if (!/^[1-9][0-9]{3}\/[1-9][0-9]{3}$/.test(year) || Number(year.slice(5)) !== Number(year.slice(0, 4)) + 1) invalid("academicYear must use consecutive years such as 2026/2027");
  return year;
}
export function courseInput(value: unknown, partial: false): CourseInput;
export function courseInput(value: unknown, partial: true): Partial<CourseInput>;
export function courseInput(value: unknown, partial: boolean) {
  const body = object(value);
  const fields = ["code", "name", "department"] as const;
  onlyKeys(body, fields);
  if (!Object.keys(body).length) invalid("Provide at least one course field");
  const result: Partial<CourseInput> = {};
  for (const field of fields) {
    if (!Object.hasOwn(body, field)) { if (!partial) invalid(`${field} is required`); continue; }
    result[field] = field === "code" ? code(body[field], field, 64) : text(body[field], field, field === "name" ? 200 : 150);
  }
  return result;
}
export function sectionInput(value: unknown, partial: false): SectionInput;
export function sectionInput(value: unknown, partial: true): Partial<SectionInput>;
export function sectionInput(value: unknown, partial: boolean) {
  const body = object(value);
  const fields = ["code", "courseId", "lecturerId", "room", "schedule", "academicYear", "term"] as const;
  onlyKeys(body, fields);
  if (!Object.keys(body).length) invalid("Provide at least one class-section field");
  const result: Partial<SectionInput> = {};
  for (const field of fields) {
    if (!Object.hasOwn(body, field)) { if (!partial) invalid(`${field} is required`); continue; }
    switch (field) {
      case "code": result.code = code(body.code, field, 64); break;
      case "courseId": result.courseId = courseId(body.courseId); break;
      case "lecturerId": result.lecturerId = lecturerId(body.lecturerId); break;
      case "academicYear": result.academicYear = academicYear(body.academicYear); break;
      case "term": result.term = code(body.term, field, 40); break;
      default: result[field] = text(body[field], field, field === "room" ? 100 : 200);
    }
  }
  return result;
}
export function academicQuery(value: unknown, sections: boolean) {
  const query = object(value);
  onlyKeys(query, sections ? ["page", "limit", "courseId", "lecturerId", "academicYear", "term"] : ["page", "limit"]);
  function integer(key: string, fallback: number, max: number) {
    if (query[key] === undefined) return fallback;
    if (typeof query[key] !== "string" || !/^[1-9][0-9]*$/.test(query[key])) invalid(`${key} must be a positive integer`);
    const number = Number(query[key]);
    if (!Number.isSafeInteger(number) || number > max) invalid(`${key} must be between 1 and ${max}`);
    return number;
  }
  return { page: integer("page", 1, 10000), limit: integer("limit", 20, 100),
    courseId: query.courseId === undefined ? undefined : courseId(query.courseId),
    lecturerId: query.lecturerId === undefined ? undefined : lecturerId(query.lecturerId),
    academicYear: query.academicYear === undefined ? undefined : academicYear(query.academicYear),
    term: query.term === undefined ? undefined : code(query.term, "term", 40) };
}
