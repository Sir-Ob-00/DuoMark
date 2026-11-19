import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import * as controller from "../controllers/admin-session.controller.js";

export const adminSessionRouter = Router();
adminSessionRouter.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });
adminSessionRouter.use(requireAuth, requireRole("ADMIN"));
adminSessionRouter.get("/", controller.listSessions);
adminSessionRouter.get("/:sessionId", controller.getSession);
