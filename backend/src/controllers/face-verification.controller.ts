import type { RequestHandler } from "express";
import { HttpError } from "../utils/http-error.js";
import { verifyFace } from "../services/face-verification.service.js";

export const verifyFaceCheckIn: RequestHandler = async (request, response) => {
  const body: unknown = request.body;
  const hasBytes = Number(request.get("Content-Length") ?? 0) > 0 || Boolean(request.get("Transfer-Encoding"));
  if ((hasBytes && !request.is("application/json")) || Object.keys(request.query).length ||
      (body !== undefined && (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length))) {
    throw new HttpError(400, "Face verification accepts no student IDs, outcomes, scores, biometric payloads or query parameters");
  }
  response.status(201).json(await verifyFace(request.device!));
};
