import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import * as controller from "../controllers/lecturer.controller.js";
import { inviteLecturer } from "../controllers/invitation.controller.js";

export const lecturerRouter = Router();
lecturerRouter.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });
lecturerRouter.use(requireAuth, requireRole("ADMIN"));
lecturerRouter.get("/", controller.listLecturers);
lecturerRouter.post("/", controller.createLecturer);
lecturerRouter.get("/:lecturerId", controller.getLecturer);
lecturerRouter.patch("/:lecturerId", controller.updateLecturer);
lecturerRouter.patch("/:lecturerId/status", controller.setLecturerStatus);
lecturerRouter.post("/:lecturerId/invitation", inviteLecturer);
