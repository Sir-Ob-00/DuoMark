import { Router, type RequestHandler } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getRegister, listRecords } from "../controllers/attendance-read.controller.js";

export const attendanceReadRouter = Router();
const staffRead: RequestHandler[] = [
  (_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); },
  requireAuth, requireRole("ADMIN", "LECTURER"),
];
attendanceReadRouter.get("/sessions/:sessionId/attendance", ...staffRead, getRegister);
attendanceReadRouter.get("/attendance-records", ...staffRead, listRecords);
