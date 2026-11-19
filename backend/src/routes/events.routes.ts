import { Router } from "express";
import { streamEvents } from "../controllers/events.controller.js";

export const eventsRouter = Router();
eventsRouter.get("/", streamEvents);
