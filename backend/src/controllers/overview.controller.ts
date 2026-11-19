import type { Request, RequestHandler } from "express";
import { adminOverview, lecturerOverview } from "../services/overview.service.js";
import { HttpError } from "../utils/http-error.js";

function noFilters(request: Request) {
  if (Object.keys(request.query).length) throw new HttpError(400, "Overview does not accept filters or pagination");
}
export const admin: RequestHandler = async (request, response) => { noFilters(request); response.json(await adminOverview()); };
export const lecturer: RequestHandler = async (request, response) => { noFilters(request); response.json(await lecturerOverview(request.actor!.id)); };
