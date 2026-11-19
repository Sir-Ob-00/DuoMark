import { Router } from "express";
import { getSession } from "../controllers/public-terminal.controller.js";

export const publicTerminalRouter = Router();
publicTerminalRouter.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });
// Public discovery only. No staff/device authentication or write capability.
publicTerminalRouter.get("/:terminalId/session", getSession);
