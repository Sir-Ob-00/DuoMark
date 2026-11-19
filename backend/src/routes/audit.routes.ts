import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getEvent, listEvents } from "../controllers/audit.controller.js";

export const auditRouter = Router();
auditRouter.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });
auditRouter.use(requireAuth, requireRole("ADMIN"));
auditRouter.get("/", listEvents);
auditRouter.get("/:eventId", getEvent);
