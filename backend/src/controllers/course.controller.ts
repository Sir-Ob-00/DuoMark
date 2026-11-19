import type { RequestHandler } from "express";
import * as service from "../services/course.service.js";
import { academicQuery, courseId, courseInput } from "../validation/academic.validation.js";
export const listCourses: RequestHandler = async (request, response) => {
  response.json(await service.listCourses(academicQuery(request.query, false), request.actor!));
};
export const createCourse: RequestHandler = async (request, response) => {
  const course = await service.createCourse(courseInput(request.body, false), request.actor!.id);
  response.status(201).json({ course });
};
export const updateCourse: RequestHandler = async (request, response) => {
  response.json({ course: await service.updateCourse(courseId(request.params.courseId), courseInput(request.body, true), request.actor!.id) });
};
