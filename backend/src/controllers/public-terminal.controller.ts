import type { RequestHandler } from "express";
import { terminalId } from "../validation/terminal.validation.js";
import { getPublicTerminalSession } from "../services/public-terminal.service.js";
import { HttpError } from "../utils/http-error.js";

export const getSession: RequestHandler = async (request, response) => {
  if (Object.keys(request.query).length) throw new HttpError(400, "Terminal display does not accept query parameters");
  response.json(await getPublicTerminalSession(terminalId(request.params.terminalId)));
};
