import type { RequestHandler } from "express";
import { adminSessionQuery } from "../validation/admin-session.validation.js";
import { sessionId } from "../validation/session.validation.js";
import { getAdminSession, listAdminSessions } from "../services/admin-session.service.js";

export const listSessions: RequestHandler = async (request, response) => {
  response.json(await listAdminSessions(adminSessionQuery(request.query)));
};
export const getSession: RequestHandler = async (request, response) => {
  response.json({ session: await getAdminSession(sessionId(request.params.sessionId)) });
};
