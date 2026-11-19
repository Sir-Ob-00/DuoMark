import type { RequestHandler } from "express";
import { reportExportInput } from "../validation/report-export.validation.js";
import { reportExport } from "../services/report-export.service.js";
import { HttpError } from "../utils/http-error.js";

export const receiveExport: RequestHandler = async (request, response) => {
  if (Object.keys(request.query).length) throw new HttpError(400, "Export acknowledgement does not accept query parameters");
  const result = await reportExport(reportExportInput(request.body, request.actor!.role === "ADMIN"), request.actor!);
  response.status(result.status).json(result.body);
};
