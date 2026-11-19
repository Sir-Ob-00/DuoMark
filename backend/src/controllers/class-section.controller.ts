import type { RequestHandler } from "express";
import * as service from "../services/class-section.service.js";
import { academicQuery, sectionId, sectionInput } from "../validation/academic.validation.js";
export const listSections: RequestHandler = async (request, response) => {
  response.json(await service.listSections(academicQuery(request.query, true), request.actor!));
};
export const createSection: RequestHandler = async (request, response) => {
  const classSection = await service.createSection(sectionInput(request.body, false), request.actor!.id);
  response.location(`/api/v1/class-sections/${classSection.id}`).status(201).json({ classSection });
};
export const getSection: RequestHandler = async (request, response) => {
  response.json({ classSection: await service.getSection(sectionId(request.params.sectionId), request.actor!) });
};
export const updateSection: RequestHandler = async (request, response) => {
  response.json({ classSection: await service.updateSection(sectionId(request.params.sectionId), sectionInput(request.body, true), request.actor!.id) });
};
