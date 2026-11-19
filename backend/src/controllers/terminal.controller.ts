import type { RequestHandler } from "express";
import * as service from "../services/terminal.service.js";
import { terminalAvailability, terminalId, terminalInput, terminalProfile, terminalQuery } from "../validation/terminal.validation.js";

export const listTerminals: RequestHandler = async (request, response) => {
  response.json(await service.listTerminals(terminalQuery(request.query)));
};
export const createTerminal: RequestHandler = async (request, response) => {
  const terminal = await service.createTerminal(terminalInput(request.body), request.actor!.id);
  response.location(`/api/v1/admin/terminals/${terminal.id}`).status(201).json({ terminal });
};
export const getTerminal: RequestHandler = async (request, response) => {
  response.json({ terminal: await service.getTerminal(terminalId(request.params.terminalId)) });
};
export const updateTerminal: RequestHandler = async (request, response) => {
  response.json({ terminal: await service.updateTerminal(terminalId(request.params.terminalId), terminalProfile(request.body), request.actor!.id) });
};
export const setAvailability: RequestHandler = async (request, response) => {
  response.json({ terminal: await service.setTerminalAvailability(terminalId(request.params.terminalId), terminalAvailability(request.body), request.actor!.id) });
};
