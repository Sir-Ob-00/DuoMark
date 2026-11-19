import type { RequestHandler } from "express";
import { lecturerId } from "../validation/lecturer.validation.js";
import { requestLecturerInvitation } from "../services/invitation.service.js";
import { HttpError } from "../utils/http-error.js";

export const inviteLecturer: RequestHandler = async (request, response) => {
  const body: unknown = request.body;
  if (Object.keys(request.query).length || (body !== undefined && (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length))) {
    throw new HttpError(400, "Invitation requests accept the lecturer path ID only; no payload or query parameters");
  }
  const result = await requestLecturerInvitation(lecturerId(request.params.lecturerId), request.actor!.id);
  response.status(result.status).json(result.body);
};
