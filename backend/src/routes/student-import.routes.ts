import express, { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { schema, template, validate, commit } from "../controllers/student-import.controller.js";
import { IMPORT_MAX_BYTES } from "../validation/student-import.validation.js";

export const studentImportRouter = Router();
studentImportRouter.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });
studentImportRouter.use(requireAuth, requireRole("ADMIN"));
studentImportRouter.get("/schema", schema);
studentImportRouter.get("/templates/:format", template);
const file = express.raw({ type: "application/octet-stream", limit: IMPORT_MAX_BYTES, inflate: false });
studentImportRouter.post("/validate", file, validate);
studentImportRouter.post("/commit", file, commit);
