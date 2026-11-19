import { HttpError } from "../utils/http-error.js";

export function modalityInput(value: unknown): "face" | "fingerprint" {
  if (value !== "face" && value !== "fingerprint") throw new HttpError(400, "modality must be face or fingerprint");
  return value;
}
export function captureInput(value: unknown, enrolling: boolean) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Expected a JSON object");
  const body = value as Record<string, unknown>;
  const keys = enrolling ? ["requestId", "deviceId", "identityVerified", "studentIndexNumber"] : ["requestId", "deviceId", "action"];
  if (Object.keys(body).some(key => !keys.includes(key))) throw new HttpError(400, "Request contains unsupported fields; browser outcomes and biometric data are not accepted");
  if (typeof body.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId)) throw new HttpError(400, "requestId must be a UUID used as the idempotency key");
  if (typeof body.deviceId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(body.deviceId)) throw new HttpError(400, "deviceId must be an approved device identifier");
  let index: string | null = null;
  if (enrolling) {
    if (body.identityVerified !== true) throw new HttpError(400, "identityVerified must confirm the administrator checked the student's identity");
    if (typeof body.studentIndexNumber !== "string" || !/^[A-Za-z0-9][A-Za-z0-9/_-]{0,63}$/.test(body.studentIndexNumber.trim())) throw new HttpError(400, "studentIndexNumber must match the student's index number");
    index = body.studentIndexNumber.trim().toUpperCase();
  } else if (body.action !== "remove" && body.action !== "reset") throw new HttpError(400, "action must be remove or reset");
  return { requestId: body.requestId.toLowerCase(), deviceId: body.deviceId, identityIndexNumber: index,
    operation: enrolling ? "ENROLL" as const : body.action === "remove" ? "REMOVE" as const : "RESET" as const };
}
