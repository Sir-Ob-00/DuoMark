import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { receiveExport } from "../controllers/report-export.controller.js";

export const reportExportRouter = Router();
reportExportRouter.post("/", (_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); }, requireAuth, requireRole("ADMIN", "LECTURER"), receiveExport);
