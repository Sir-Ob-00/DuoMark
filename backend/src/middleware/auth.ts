import type { Request, RequestHandler } from "express";
import { authConfig } from "../config/auth.js";
import { consumeSignInLimit, resolveSession } from "../services/auth.service.js";
import type { StaffRole } from "../generated/prisma/client.js";

export type StaffActor = NonNullable<Awaited<ReturnType<typeof resolveSession>>>;
declare global {
  namespace Express { interface Request { actor?: StaffActor } }
}
export function sessionToken(request: Request) {
  const values = (request.headers.cookie ?? "").split(";").map(value => value.trim())
    .filter(value => value.startsWith(`${authConfig.cookieName}=`));
  if (values.length !== 1) return undefined;
  const token = values[0].slice(authConfig.cookieName.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
}
export const requireAuth: RequestHandler = async (request, response, next) => {
  const token = sessionToken(request);
  const actor = token ? await resolveSession(token) : null;
  if (!actor) { response.status(401).json({ error: "Authentication required" }); return; }
  request.actor = actor;
  next();
};
export const requireRole = (...roles: StaffRole[]): RequestHandler => (request, response, next) => {
  if (!request.actor) { response.status(401).json({ error: "Authentication required" }); return; }
  if (!roles.includes(request.actor.role)) { response.status(403).json({ error: "Forbidden" }); return; }
  next();
};
// Apply to all API mutations, including login CSRF. Custom header forces browser preflight.
export const browserSecurity: RequestHandler = (request, response, next) => {
  response.vary("Origin");
  const origin = request.get("Origin");
  if (origin && !authConfig.origins.includes(origin)) { response.status(403).json({ error: "Origin not allowed" }); return; }
  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
  }
  if (request.method === "OPTIONS") {
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Protection");
    response.sendStatus(204); return;
  }
  if (!["GET", "HEAD"].includes(request.method) && (!origin || request.get("X-CSRF-Protection") !== "1")) {
    response.status(403).json({ error: "CSRF validation failed" }); return;
  }
  next();
};
export const signInRateLimit: RequestHandler = async (request, response, next) => {
  const ip = await consumeSignInLimit(`ip:${request.ip ?? "unknown"}`, 30);
  if (!ip.allowed) { response.setHeader("Retry-After", ip.retryAfter); response.status(429).json({ error: "Too many sign-in attempts" }); return; }
  const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase().slice(0, 254) : "";
  const account = await consumeSignInLimit(`email:${email}`, 10);
  if (!account.allowed) { response.setHeader("Retry-After", account.retryAfter); response.status(429).json({ error: "Too many sign-in attempts" }); return; }
  next();
};
