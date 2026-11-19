import { prisma } from "../db/prisma.js";
import { captureService } from "./capture-service.js";
import { completeCaptureCommand } from "../services/capture.service.js";

// Local operator/test entry point, not imported by browser-facing routes.
// It performs no biometric capture, persistence, matching or deletion.
export async function confirmDevelopmentAttempt(attemptId: string) {
  const service = captureService();
  const command = await prisma.captureAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  return completeCaptureCommand({ attemptId: command.id, studentId: command.studentId, modality: command.modality,
    operation: command.operation, deviceId: command.deviceId, eventId: `fake:${command.id}`, consentId: command.consentId,
    identityIndexNumber: command.identityIndexNumber, identityVerified: command.operation === "ENROLL", deletionConfirmed: command.operation !== "ENROLL",
  }, service.serviceId);
}
