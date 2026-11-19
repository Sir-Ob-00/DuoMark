import type { ErrorRequestHandler, RequestHandler } from "express";
import { HttpError } from "../utils/http-error.js";
import { verifyFingerprint } from "../services/fingerprint-verification.service.js";

export const verifyFingerprintCheckIn: RequestHandler = async (request, response) => {
  const body: unknown = request.body;
  if (!request.is("application/json") || !body || typeof body !== "object" || Array.isArray(body) || Object.keys(request.query).length ||
      Object.keys(body).length !== 1 || !("attemptId" in body) || typeof body.attemptId !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.attemptId)) {
    response.status(400).json({ outcome: "invalid-request", error: "Submit only the opaque attemptId as JSON; verification evidence is not accepted" }); return;
  }
  const result = await verifyFingerprint(request.device!, body.attemptId);
  response.status(result.status).json(result.body);
};
// Normalize authentication, integration and parser failures without logging data.
export const fingerprintErrors: ErrorRequestHandler = (error, _request, response, _next) => {
  const status = error instanceof HttpError ? error.status : error?.status === 400 ? 400 : error?.status === 413 ? 413 : 500;
  const outcome = status === 503 ? "service-unavailable" : status === 401 || status === 403 ? "device-error" : status === 400 || status === 413 ? "invalid-request" : "server-error";
  response.status(status).json({ outcome, error: error instanceof HttpError ? error.message : status === 400 ? "Invalid JSON" : status === 413 ? "Request too large" : "Check-in could not be completed; retry safely" });
};
