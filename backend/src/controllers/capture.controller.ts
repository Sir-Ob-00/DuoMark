import type { RequestHandler } from "express";
import { studentPathId } from "../validation/student.validation.js";
import { captureInput, modalityInput } from "../validation/capture.validation.js";
import { requestCapture } from "../services/capture.service.js";
import { HttpError } from "../utils/http-error.js";

function operation(enrolling: boolean): RequestHandler {
  return async (request, response) => {
    if (Object.keys(request.query).length) throw new HttpError(400, "Enrollment operations do not accept query parameters");
    const id = studentPathId(request.params.studentId);
    const modality = modalityInput(request.params.modality);
    const input = captureInput(request.body, enrolling);
    const attempt = await requestCapture(id, modality, input, request.actor!.id);
    response.status(attempt.status === "REQUESTED" ? 202 : 200).json({ attempt, developmentOnly: true });
  };
}
export const startEnrollment = operation(true);
export const removeEnrollment = operation(false);
