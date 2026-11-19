import { Router } from "express";
import { createSession, currentStaff, deleteSession } from "../controllers/auth.controller.js";
import { requireAuth, signInRateLimit } from "../middleware/auth.js";

export const authRouter = Router();
authRouter.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });
authRouter.post("/session", signInRateLimit, createSession);
authRouter.get("/me", requireAuth, currentStaff);
authRouter.delete("/session", deleteSession);
