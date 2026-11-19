import type { RequestHandler } from "express";
import * as service from "../services/attendance-session.service.js";
import { closeSessionInput, openSessionInput, sessionId, sessionQuery } from "../validation/session.validation.js";
export const listSessions: RequestHandler = async (request, response) => {
  response.json(await service.listSessions(request.actor!.id, sessionQuery(request.query)));
};
export const openSession: RequestHandler = async (request, response) => {
  const session = await service.openSession(openSessionInput(request.body, request.query), request.actor!.id);
  response.location(`/api/v1/lecturer/sessions/${session.id}`).status(201).json({ session });
};
export const getSession: RequestHandler = async (request, response) => {
  response.json({ session: await service.getSession(sessionId(request.params.sessionId), request.actor!.id) });
};
export const closeSession: RequestHandler = async (request, response) => {
  closeSessionInput(request.body, request.query);
  response.json({ session: await service.closeSession(sessionId(request.params.sessionId), request.actor!.id) });
};
