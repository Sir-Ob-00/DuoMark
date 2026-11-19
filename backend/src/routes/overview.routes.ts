import { Router, type RequestHandler } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { admin, lecturer } from "../controllers/overview.controller.js";

export const overviewRouter = Router();
const noStore: RequestHandler = (_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); };
overviewRouter.get("/admin/overview", noStore, requireAuth, requireRole("ADMIN"), admin);
overviewRouter.get("/lecturer/overview", noStore, requireAuth, requireRole("LECTURER"), lecturer);
