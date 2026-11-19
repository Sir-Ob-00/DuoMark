import { HttpError } from "../utils/http-error.js";

export type TerminalInput = { id: string; name: string; location: string };
export type TerminalProfile = Pick<TerminalInput, "name" | "location">;
function invalid(message: string): never { throw new HttpError(400, message); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Expected a JSON object");
  return value as Record<string, unknown>;
}
function onlyKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some(key => !keys.includes(key))) invalid("Request contains unsupported fields");
}
function text(value: unknown, field: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) invalid(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}
export function terminalId(value: unknown) {
  if (typeof value !== "string" || value.length < 2 || value.length > 40 || !/^[a-z0-9]([a-z0-9]|-[a-z0-9])*$/.test(value)) {
    invalid("terminalId must be 2–40 lowercase letters/digits with single internal hyphens");
  }
  return value;
}
export function terminalInput(value: unknown): TerminalInput {
  const body = object(value);
  onlyKeys(body, ["id", "name", "location"]);
  return { id: terminalId(text(body.id, "id", 40).toLowerCase()), name: text(body.name, "name", 200), location: text(body.location, "location", 200) };
}
export function terminalProfile(value: unknown): Partial<TerminalProfile> {
  const body = object(value);
  onlyKeys(body, ["name", "location"]);
  if (!Object.keys(body).length) invalid("Provide at least one terminal profile field");
  const result: Partial<TerminalProfile> = {};
  for (const field of ["name", "location"] as const) if (Object.hasOwn(body, field)) result[field] = text(body[field], field, 200);
  return result;
}
function statusValue(value: unknown): "Available" | "Unavailable" {
  if (value !== "Available" && value !== "Unavailable") invalid("status must be Available or Unavailable");
  return value;
}
export function terminalAvailability(value: unknown) {
  const body = object(value);
  onlyKeys(body, ["status"]);
  return statusValue(body.status);
}
export function terminalQuery(value: unknown) {
  const query = object(value);
  onlyKeys(query, ["page", "limit", "search", "status"]);
  function integer(key: string, fallback: number, max: number) {
    if (query[key] === undefined) return fallback;
    if (typeof query[key] !== "string" || !/^[1-9][0-9]*$/.test(query[key])) invalid(`${key} must be a positive integer`);
    const number = Number(query[key]);
    if (!Number.isSafeInteger(number) || number > max) invalid(`${key} must be between 1 and ${max}`);
    return number;
  }
  return { page: integer("page", 1, 10000), limit: integer("limit", 20, 100),
    search: query.search === undefined ? undefined : text(query.search, "search", 200),
    status: query.status === undefined ? undefined : statusValue(query.status) };
}
