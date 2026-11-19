import { HttpError } from "../utils/http-error.js";
import { sectionId } from "./academic.validation.js";
import { terminalId } from "./terminal.validation.js";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Expected a JSON object");
  return value as Record<string, unknown>;
}
export function openSessionInput(value: unknown, query: object) {
  const body = object(value);
  if (Object.keys(query).length || Object.keys(body).some(key => key !== "sectionId" && key !== "terminalId")) throw new HttpError(400, "Opening accepts sectionId and terminalId only");
  return { sectionId: sectionId(body.sectionId), terminalId: terminalId(body.terminalId) };
}
export function sessionId(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new HttpError(400, "sessionId must be a UUID");
  return value;
}
export function closeSessionInput(body: unknown, query: object) {
  if (Object.keys(query).length || (body !== undefined && Object.keys(object(body)).length)) throw new HttpError(400, "Closing does not accept payload or query parameters");
}
export function sessionQuery(value: unknown) {
  const query = object(value);
  if (Object.keys(query).some(key => !["page", "limit", "view"].includes(key))) throw new HttpError(400, "Unsupported session query fields");
  function integer(key: string, fallback: number, maximum: number) {
    if (query[key] === undefined) return fallback;
    if (typeof query[key] !== "string" || !/^[1-9][0-9]*$/.test(query[key])) throw new HttpError(400, `${key} must be a positive integer`);
    const number = Number(query[key]);
    if (!Number.isSafeInteger(number) || number > maximum) throw new HttpError(400, `${key} must be between 1 and ${maximum}`);
    return number;
  }
  const view = query.view ?? "all";
  if (view !== "all" && view !== "active" && view !== "history") throw new HttpError(400, "view must be all, active or history");
  return { page: integer("page", 1, 10000), limit: integer("limit", 20, 100), view };
}
