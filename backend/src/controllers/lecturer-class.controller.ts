import type { RequestHandler } from "express";
import { academicQuery } from "../validation/academic.validation.js";
import { myClasses } from "../services/lecturer-class.service.js";

export const listMyClasses: RequestHandler = async (request, response) => {
  response.json(await myClasses(request.actor!.id, academicQuery(request.query, false)));
};
