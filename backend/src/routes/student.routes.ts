import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import * as controller from "../controllers/student.controller.js";
import { startEnrollment, removeEnrollment } from "../controllers/capture.controller.js";

export const studentRouter = Router();
studentRouter.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });
studentRouter.use(requireAuth, requireRole("ADMIN"));
studentRouter.get("/", controller.listStudents);
studentRouter.post("/", controller.createStudent);
studentRouter.get("/:studentId", controller.getStudent);
studentRouter.patch("/:studentId", controller.updateStudent);
studentRouter.get("/:studentId/enrollment", controller.getEnrollment);
studentRouter.post("/:studentId/enrollment/consent", controller.recordConsent);
studentRouter.post("/:studentId/enrollment/:modality", startEnrollment);
studentRouter.delete("/:studentId/enrollment/:modality", removeEnrollment);
