import type { RequestHandler } from "express";
import * as students from "../services/student.service.js";
import { consentInput, studentInput, studentPathId, studentQuery } from "../validation/student.validation.js";

export const listStudents: RequestHandler = async (request, response) => {
  response.json(await students.listStudents(studentQuery(request.query)));
};
export const createStudent: RequestHandler = async (request, response) => {
  const student = await students.createStudent(studentInput(request.body, false), request.actor!.id);
  response.location(`/api/v1/admin/students/${student.id}`).status(201).json({ student });
};
export const getStudent: RequestHandler = async (request, response) => {
  response.json({ student: await students.getStudent(studentPathId(request.params.studentId)) });
};
export const updateStudent: RequestHandler = async (request, response) => {
  response.json({ student: await students.updateStudent(studentPathId(request.params.studentId), studentInput(request.body, true), request.actor!.id) });
};
export const getEnrollment: RequestHandler = async (request, response) => {
  response.json({ enrollment: await students.getEnrollment(studentPathId(request.params.studentId)) });
};
export const recordConsent: RequestHandler = async (request, response) => {
  const enrollment = await students.recordConsent(studentPathId(request.params.studentId), consentInput(request.body), request.actor!.id);
  response.status(201).json({ enrollment });
};
