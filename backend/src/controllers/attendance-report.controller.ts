import type { RequestHandler } from "express";
import { attendanceReportQuery } from "../validation/attendance-report.validation.js";
import { attendanceReport } from "../services/attendance-report.service.js";

export const adminReport: RequestHandler = async (request, response) => {
  response.json(await attendanceReport(attendanceReportQuery(request.query, true), request.actor!));
};
export const lecturerReport: RequestHandler = async (request, response) => {
  response.json(await attendanceReport(attendanceReportQuery(request.query, false), request.actor!));
};
