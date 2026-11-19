import type { RequestHandler } from "express";
import { sectionId } from "../validation/academic.validation.js";
import { studentPathId } from "../validation/student.validation.js";
import { HttpError } from "../utils/http-error.js";
import { addRosterStudent, removeRosterStudent } from "../services/roster.service.js";

function noPayload(body: unknown, query: object) {
  if (Object.keys(query).length || (body !== undefined && (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length))) {
    throw new HttpError(400, "Roster writes accept path identifiers only; no payload or query parameters");
  }
}
export const addStudent: RequestHandler = async (request, response) => {
  noPayload(request.body, request.query);
  const membership = await addRosterStudent(sectionId(request.params.sectionId), studentPathId(request.params.studentId), request.actor!.id);
  response.location(`/api/v1/class-sections/${membership.sectionId}/roster/${membership.studentId}`).status(201).json({ membership });
};
export const removeStudent: RequestHandler = async (request, response) => {
  noPayload(request.body, request.query);
  await removeRosterStudent(sectionId(request.params.sectionId), studentPathId(request.params.studentId), request.actor!.id);
  response.status(204).end();
};
