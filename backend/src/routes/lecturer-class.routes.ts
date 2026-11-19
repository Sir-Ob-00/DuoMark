import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { listMyClasses } from "../controllers/lecturer-class.controller.js";

export const lecturerClassRouter = Router();
lecturerClassRouter.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });
lecturerClassRouter.use(requireAuth, requireRole("LECTURER"));
lecturerClassRouter.get("/classes", listMyClasses);
