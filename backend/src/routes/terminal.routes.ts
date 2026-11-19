import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import * as controller from "../controllers/terminal.controller.js";

export const terminalRouter = Router();
terminalRouter.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });
terminalRouter.use(requireAuth, requireRole("ADMIN"));
terminalRouter.get("/", controller.listTerminals);
terminalRouter.post("/", controller.createTerminal);
terminalRouter.get("/:terminalId", controller.getTerminal);
terminalRouter.patch("/:terminalId", controller.updateTerminal);
terminalRouter.patch("/:terminalId/availability", controller.setAvailability);
