import type { RequestHandler } from "express";
import { lecturerId } from "../validation/lecturer.validation.js";
import { requestLecturerInvitation, redeemLecturerInvitation } from "../services/invitation.service.js";
import { consumeSignInLimit } from "../services/auth.service.js";
import { HttpError } from "../utils/http-error.js";

export const inviteLecturer: RequestHandler = async (request, response) => {
  const body: unknown = request.body;
  if (Object.keys(request.query).length || (body !== undefined && (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length))) {
    throw new HttpError(400, "Invitation requests accept the lecturer path ID only; no payload or query parameters");
  }
  const limit = await consumeSignInLimit(`invitation-admin:${request.actor!.id}`, 20);
  if (!limit.allowed) { response.setHeader("Retry-After", limit.retryAfter); throw new HttpError(429, "Too many invitation requests; try again later"); }
  const result = await requestLecturerInvitation(lecturerId(request.params.lecturerId), request.actor!.id);
  response.status(result.status).json(result.body);
};

export const activateLecturer: RequestHandler = async (request, response) => {
  const limit = await consumeSignInLimit(`invitation-redemption:${request.ip ?? "unknown"}`, 30);
  if (!limit.allowed) { response.setHeader("Retry-After", limit.retryAfter); throw new HttpError(429, "Too many activation attempts; try again later"); }
  const body = request.body;
  if (Object.keys(request.query).length || !body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["token", "password", "passwordConfirmation"].includes(key)) ||
      typeof body.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.token) || typeof body.password !== "string" || body.password.length < 12 || Buffer.byteLength(body.password) > 1024 || body.passwordConfirmation !== body.password) throw new HttpError(400, "Provide a valid invitation and matching passwords of at least 12 characters (at most 1024 bytes)");
  response.json(await redeemLecturerInvitation(body.token, body.password));
};
