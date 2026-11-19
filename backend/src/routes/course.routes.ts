import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import * as controller from "../controllers/course.controller.js";
export const courseRouter = Router();
courseRouter.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });
courseRouter.use(requireAuth, requireRole("ADMIN", "LECTURER"));
courseRouter.get("/", controller.listCourses);
courseRouter.post("/", requireRole("ADMIN"), controller.createCourse);
courseRouter.patch("/:courseId", requireRole("ADMIN"), controller.updateCourse);
