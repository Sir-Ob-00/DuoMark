import { HttpError } from "../utils/http-error.js";

export type LecturerInput = { name: string; email: string };
function invalid(message: string): never { throw new HttpError(400, message); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Expected a JSON object");
  return value as Record<string, unknown>;
}
function onlyKeys(body: Record<string, unknown>, keys: string[]) {
  if (Object.keys(body).some(key => !keys.includes(key))) invalid("Request contains unsupported fields");
}
function text(value: unknown, field: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) invalid(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}
export function lecturerInput(value: unknown, partial: false): LecturerInput;
export function lecturerInput(value: unknown, partial: true): Partial<LecturerInput>;
export function lecturerInput(value: unknown, partial: boolean) {
  const body = object(value);
  onlyKeys(body, ["name", "email"]);
  if (!Object.keys(body).length) invalid("Provide at least one lecturer profile field");
  const result: Partial<LecturerInput> = {};
  for (const field of ["name", "email"] as const) {
    if (!Object.hasOwn(body, field)) { if (!partial) invalid(`${field} is required`); continue; }
    const input = text(body[field], field, field === "name" ? 200 : 254);
    if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)) invalid("email must be a valid email address");
    result[field] = field === "email" ? input.toLowerCase() : input;
  }
  return result;
}
export function lecturerId(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) invalid("lecturerId must be the lecturer's UUID");
  return value;
}
function statusValue(value: unknown): "Active" | "Inactive" {
  if (value !== "Active" && value !== "Inactive") invalid("status must be Active or Inactive");
  return value;
}
export function lecturerStatus(value: unknown) {
  const body = object(value);
  onlyKeys(body, ["status"]);
  return statusValue(body.status);
}
export function lecturerQuery(value: unknown) {
  const query = object(value);
  onlyKeys(query, ["page", "limit", "search", "status"]);
  function integer(key: string, fallback: number, maximum: number) {
    if (query[key] === undefined) return fallback;
    if (typeof query[key] !== "string" || !/^[1-9][0-9]*$/.test(query[key])) invalid(`${key} must be a positive integer`);
    const number = Number(query[key]);
    if (!Number.isSafeInteger(number) || number > maximum) invalid(`${key} must be between 1 and ${maximum}`);
    return number;
  }
  return { page: integer("page", 1, 10000), limit: integer("limit", 20, 100),
    status: query.status === undefined ? undefined : statusValue(query.status),
    search: query.search === undefined ? undefined : text(query.search, "search", 254) };
}
