import type { RequestHandler } from "express";
import * as service from "../services/lecturer.service.js";
import { lecturerId, lecturerInput, lecturerQuery, lecturerStatus } from "../validation/lecturer.validation.js";

export const listLecturers: RequestHandler = async (request, response) => {
  response.json(await service.listLecturers(lecturerQuery(request.query)));
};
export const createLecturer: RequestHandler = async (request, response) => {
  const lecturer = await service.createLecturer(lecturerInput(request.body, false), request.actor!.id);
  response.location(`/api/v1/admin/lecturers/${lecturer.id}`).status(201).json({ lecturer });
};
export const getLecturer: RequestHandler = async (request, response) => {
  response.json({ lecturer: await service.getLecturer(lecturerId(request.params.lecturerId)) });
};
export const updateLecturer: RequestHandler = async (request, response) => {
  response.json({ lecturer: await service.updateLecturer(lecturerId(request.params.lecturerId), lecturerInput(request.body, true), request.actor!.id) });
};
export const setLecturerStatus: RequestHandler = async (request, response) => {
  response.json({ lecturer: await service.setLecturerStatus(lecturerId(request.params.lecturerId), lecturerStatus(request.body), request.actor!.id) });
};
