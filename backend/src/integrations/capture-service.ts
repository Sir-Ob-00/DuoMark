import { HttpError } from "../utils/http-error.js";

// Metadata-only boundary. Real capture, template storage and service authentication
// are deliberately not implemented until the integration/data design is approved.
export interface CaptureService {
  readonly serviceId: string;
  readonly deviceIds: readonly string[];
  readonly developmentOnly: boolean;
}
export const fakeCaptureService: CaptureService = Object.freeze({
  serviceId: "development-fake-capture", deviceIds: Object.freeze(["development-fake-device"]), developmentOnly: true,
});
export function captureService(): CaptureService {
  if (process.env.NODE_ENV === "development" && process.env.BIOMETRIC_CAPTURE_MODE === "development-fake") return fakeCaptureService;
  throw new HttpError(503, "Biometric capture service unavailable: production integration and biometric-data design are not approved");
}

// A future authenticated adapter consumes persisted REQUESTED commands using
// attempt.id as the remote idempotency key. It must authenticate its service/device
// principal independently of staff cookies before calling completeCaptureCommand.
export interface CaptureConfirmation {
  attemptId: string;
  studentId: string;
  modality: "face" | "fingerprint";
  operation: "ENROLL" | "REMOVE" | "RESET";
  deviceId: string;
  eventId: string;
  consentId: string | null;
  identityIndexNumber: string | null;
  identityVerified: boolean;
  deletionConfirmed: boolean;
}
