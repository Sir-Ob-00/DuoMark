import type { RequestHandler } from "express";
import { authConfig } from "../config/auth.js";
import { sessionToken } from "../middleware/auth.js";
import { signIn, signOut } from "../services/auth.service.js";

export const createSession: RequestHandler = async (request, response) => {
  const { email, password } = request.body ?? {};
  if (typeof email !== "string" || email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof password !== "string" || password.length < 1 || Buffer.byteLength(password) > 1024) {
    response.status(400).json({ error: "A valid email and password are required" }); return;
  }
  const result = await signIn(email.trim().toLowerCase(), password, sessionToken(request));
  if (!result) { response.status(401).json({ error: "Invalid email or password" }); return; }
  response.cookie(authConfig.cookieName, result.token, { ...authConfig.cookie, maxAge: authConfig.ttl * 1000 });
  response.status(200).json({ user: result.user });
};
export const currentStaff: RequestHandler = (request, response) => { response.json({ user: request.actor }); };
export const deleteSession: RequestHandler = async (request, response) => {
  await signOut(sessionToken(request));
  response.clearCookie(authConfig.cookieName, authConfig.cookie);
  response.sendStatus(204);
};
