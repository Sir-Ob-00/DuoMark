import { HttpError } from "../utils/http-error.js";

export const profileFields = ["studentId", "name", "program", "department", "level", "classSectionId"] as const;
export type StudentInput = Record<typeof profileFields[number], string>;
const lengths: Record<string, number> = { studentId: 64, name: 200, program: 150, department: 150, level: 3, classSectionId: 100 };
function invalid(message: string): never { throw new HttpError(400, message); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Expected a JSON object");
  return value as Record<string, unknown>;
}
function onlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const unexpected = Object.keys(value).filter(key => !keys.includes(key));
  if (unexpected.length) invalid("Request contains unsupported fields");
}
function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    invalid(`${field} must be a non-empty string of at most ${max} characters`);
  }
  return value.trim();
}
function fieldValue(value: unknown, field: string) {
  const result = text(value, field, lengths[field]);
  if (field === "studentId") {
    if (!/^[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(result)) invalid("studentId must use letters, digits, /, _ or -");
    return result.toUpperCase();
  }
  if (field === "level" && !/^[1-9][0-9]{0,2}$/.test(result)) invalid("level must be a number from 1 to 999, supplied as a string");
  if (field === "classSectionId" && !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(result)) invalid("classSectionId must be an identifier using letters, digits, _ or -");
  return result;
}
export function studentInput(value: unknown, partial: false): StudentInput;
export function studentInput(value: unknown, partial: true): Partial<StudentInput>;
export function studentInput(value: unknown, partial: boolean) {
  const body = object(value);
  onlyKeys(body, profileFields);
  if (!Object.keys(body).length) invalid("Provide at least one profile field");
  const result: Partial<StudentInput> = {};
  for (const field of profileFields) {
    if (Object.hasOwn(body, field)) result[field] = fieldValue(body[field], field);
    else if (!partial) invalid(`${field} is required`);
  }
  return result;
}
export function studentPathId(value: unknown) {
  const id = text(value, "studentId path parameter", 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) invalid("studentId path parameter must be the student's UUID (id)");
  return id;
}
export function consentInput(value: unknown) {
  const body = object(value);
  onlyKeys(body, ["consentVerified", "consentVersion", "consentReference"]);
  if (body.consentVerified !== true) invalid("consentVerified must be true to confirm the student's consent was verified");
  return {
    consentVersion: Object.hasOwn(body, "consentVersion") ? text(body.consentVersion, "consentVersion", 100) : null,
    consentReference: Object.hasOwn(body, "consentReference") ? text(body.consentReference, "consentReference", 500) : null,
  };
}
export function studentQuery(value: unknown) {
  const query = object(value);
  onlyKeys(query, ["page", "limit", "search", "program", "department", "level", "classSectionId", "status"]);
  function integer(key: string, fallback: number, maximum: number) {
    if (query[key] === undefined) return fallback;
    if (typeof query[key] !== "string" || !/^[1-9][0-9]*$/.test(query[key])) invalid(`${key} must be a positive integer`);
    const result = Number(query[key]);
    if (!Number.isSafeInteger(result) || result > maximum) invalid(`${key} must be between 1 and ${maximum}`);
    return result;
  }
  const page = integer("page", 1, 10000);
  const limit = integer("limit", 20, 100);
  const filters: Partial<StudentInput> = {};
  for (const field of ["program", "department", "level", "classSectionId"] as const) {
    if (query[field] !== undefined) filters[field] = fieldValue(query[field], field);
  }
  const status = query.status;
  if (status !== undefined && status !== "Pending" && status !== "Enrolled") invalid("status must be Pending or Enrolled");
  return { page, limit, filters, status, search: query.search === undefined ? undefined : text(query.search, "search", 200) };
}
