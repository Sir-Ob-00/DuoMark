import type { RequestHandler } from "express";
import { auditQuery, auditUuid } from "../validation/audit.validation.js";
import { getAuditEvent, listAuditEvents } from "../services/audit.service.js";
import { HttpError } from "../utils/http-error.js";

export const listEvents: RequestHandler = async (request, response) => { response.json(await listAuditEvents(auditQuery(request.query))); };
export const getEvent: RequestHandler = async (request, response) => {
  if (Object.keys(request.query).length) throw new HttpError(400, "Audit detail does not accept query parameters");
  response.json({ event: await getAuditEvent(auditUuid(request.params.eventId)) });
};
