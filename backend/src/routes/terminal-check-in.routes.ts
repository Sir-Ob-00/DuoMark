import express, { Router } from "express";
import { requireCheckInDevice } from "../middleware/device-auth.js";
import { verifyFaceCheckIn } from "../controllers/face-verification.controller.js";
import { fingerprintErrors, verifyFingerprintCheckIn } from "../controllers/fingerprint-verification.controller.js";

export const terminalCheckInRouter = Router();
// Separate device-only auth boundary: staff cookies/CSRF do not authenticate it.
terminalCheckInRouter.post("/:terminalId/check-ins/face-verification", requireCheckInDevice, express.json({ limit: "16kb" }), verifyFaceCheckIn);
terminalCheckInRouter.post("/:terminalId/check-ins/fingerprint-verification", requireCheckInDevice, express.json({ limit: "16kb" }), verifyFingerprintCheckIn, fingerprintErrors);
