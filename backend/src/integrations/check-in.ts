import { prisma } from "../db/prisma.js";
import { digest } from "../services/auth.service.js";
import { HttpError } from "../utils/http-error.js";

export interface DevicePrincipal { id: string; terminalId: string; developmentOnly: true }
export interface DeviceAuthenticator { authenticate(authorization?: string): Promise<DevicePrincipal> }
export interface FaceCaptureContext {
  challengeId: string; deviceId: string; terminalId: string; attendanceSessionId: string; sectionId: string; rosterStudentIds: string[];
}
export interface TrustedFaceResult {
  serviceId: string; challengeId: string; deviceId: string; terminalId: string; attendanceSessionId: string; studentId: string | null;
}
export interface FaceIdentifier { serviceId: string; identify(context: FaceCaptureContext): Promise<TrustedFaceResult> }

export interface FingerprintContext {
  challengeId: string; attemptId: string; deviceId: string; terminalId: string; attendanceSessionId: string; studentId: string;
}
export interface TrustedFingerprintResult extends FingerprintContext { serviceId: string; verified: boolean }
export interface FingerprintVerifier { serviceId: string; verify(context: FingerprintContext): Promise<TrustedFingerprintResult> }

// No approved production authenticator, transport or recognition adapter exists.
// This opt-in can never enable real capture or run against non-fictional records.
export function requireCheckInIntegration() {
  if (!["development", "test"].includes(process.env.NODE_ENV ?? "") || process.env.CHECK_IN_MODE !== "development-fake") {
    throw new HttpError(503, "Check-ins unavailable: approved device authentication and real biometric-capture integration are not configured");
  }
}
export const developmentDeviceAuthenticator: DeviceAuthenticator = {
  async authenticate(authorization) {
    requireCheckInIntegration();
    const token = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!token) throw new HttpError(401, "Device authentication required");
    const device = await prisma.developmentCheckInDevice.findUnique({ where: { credentialHash: digest(token) }, select: {
      id: true, active: true, terminalId: true, terminal: { select: { isFictional: true } },
    } });
    if (!device?.active || !device.terminal.isFictional) throw new HttpError(401, "Invalid device credentials");
    return { id: device.id, terminalId: device.terminalId, developmentOnly: true };
  },
};

export const developmentFingerprintVerifier: FingerprintVerifier = {
  serviceId: "development-fake-fingerprint-capture",
  async verify(context) {
    requireCheckInIntegration();
    const device = await prisma.developmentCheckInDevice.findUnique({ where: { id: context.deviceId }, select: { fakeStudentId: true, fakeFingerprintOutcome: true } });
    // Simulate comparison against EXACTLY the server-resolved student's enrolled
    // fingerprint. The client cannot select a candidate or supply an outcome.
    return { ...context, serviceId: this.serviceId, verified: device?.fakeFingerprintOutcome === "MATCH" && device.fakeStudentId === context.studentId };
  },
};
export const developmentFaceIdentifier: FaceIdentifier = {
  serviceId: "development-fake-face-capture",
  async identify(context) {
    requireCheckInIntegration();
    // Only local server/operator fixture state controls this fictional outcome.
    // No HTTP body flags, student IDs, scores, samples or templates are inputs.
    const device = await prisma.developmentCheckInDevice.findUnique({ where: { id: context.deviceId }, select: {
      fakeFaceOutcome: true, fakeStudentId: true,
    } });
    const studentId = device?.fakeFaceOutcome === "MATCH" && device.fakeStudentId && context.rosterStudentIds.includes(device.fakeStudentId) ? device.fakeStudentId : null;
    return { serviceId: this.serviceId, challengeId: context.challengeId, deviceId: context.deviceId,
      terminalId: context.terminalId, attendanceSessionId: context.attendanceSessionId, studentId };
  },
};
