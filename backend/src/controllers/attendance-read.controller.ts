import type { RequestHandler } from "express";
import { HttpError } from "../utils/http-error.js";
import { sessionId } from "../validation/session.validation.js";
import { attendanceQuery } from "../validation/attendance-read.validation.js";
import { getSessionAttendance, listAttendanceRecords } from "../services/attendance-read.service.js";

export const getRegister: RequestHandler = async (request, response) => {
  if (Object.keys(request.query).length) throw new HttpError(400, "Session register does not accept query parameters");
  response.json(await getSessionAttendance(sessionId(request.params.sessionId), request.actor!));
};
export const listRecords: RequestHandler = async (request, response) => {
  response.json(await listAttendanceRecords(attendanceQuery(request.query), request.actor!));
};
