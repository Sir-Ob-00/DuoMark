import { Router, type RequestHandler } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { adminReport, lecturerReport } from "../controllers/attendance-report.controller.js";

export const attendanceReportRouter = Router();
const noStore: RequestHandler = (_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); };
attendanceReportRouter.get("/admin/reports/attendance", noStore, requireAuth, requireRole("ADMIN"), adminReport);
attendanceReportRouter.get("/lecturer/reports/attendance", noStore, requireAuth, requireRole("LECTURER"), lecturerReport);
