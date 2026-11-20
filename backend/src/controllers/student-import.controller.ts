import type { RequestHandler } from "express";
import { HttpError } from "../utils/http-error.js";
import { importFormat, importColumns, IMPORT_MAX_BYTES, IMPORT_MAX_ROWS } from "../validation/student-import.validation.js";
import { parseStudentFile, studentTemplate } from "../services/student-import-file.service.js";
import { previewStudentImport, commitStudentImport } from "../services/student-import.service.js";

export const schema: RequestHandler = (request, response) => {
  if (Object.keys(request.query).length) throw new HttpError(400, "Schema does not accept query parameters");
  response.json({ columns: importColumns, limits: { maxBytes: IMPORT_MAX_BYTES, maxRows: IMPORT_MAX_ROWS } });
};
export const template: RequestHandler = async (request, response) => {
  if (Object.keys(request.query).length) throw new HttpError(400, "Template does not accept query parameters");
  const format = importFormat(request.params.format);
  response.setHeader("Content-Type", format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  response.setHeader("Content-Disposition", `attachment; filename="duomark-students-template.${format}"`);
  response.send(await studentTemplate(format));
};
function operation(commit: boolean): RequestHandler {
  return async (request, response) => {
    if (Object.keys(request.query).some(key => key !== "format")) throw new HttpError(400, "Only the file format query parameter is accepted");
    const format = importFormat(request.query.format);
    if (!Buffer.isBuffer(request.body)) throw new HttpError(400, "Upload the file bytes with Content-Type: application/octet-stream");
    const file = await parseStudentFile(request.body, format);
    if (!commit) { response.json(await previewStudentImport(file)); return; }
    const result = await commitStudentImport(file, request.actor!.id);
    response.status(result.status).json(result.body);
  };
}
export const validate = operation(false);
export const commit = operation(true);
