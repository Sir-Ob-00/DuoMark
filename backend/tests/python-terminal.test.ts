import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { digest } from "../src/services/auth.service.js";
import { developmentFingerprintVerifier } from "../src/integrations/check-in.js";
import { closeSession } from "../src/services/attendance-session.service.js";

test("Python CLI -> Express -> fictional database: one save, duplicate, mismatch, face retry and closure", async () => {
  const oldMode = process.env.CHECK_IN_MODE, oldEnv = process.env.NODE_ENV;
  process.env.CHECK_IN_MODE = "development-fake";
  process.env.NODE_ENV = "test";
  const suffix = randomUUID(), terminalId = `py-${suffix}`;
  const credential = randomBytes(32).toString("base64url");
  const originalVerify = developmentFingerprintVerifier.verify;
  const staffIds: string[] = [];
  let courseId: number | undefined, sectionId: string | undefined, studentId: string | undefined;
  let deviceId: string | undefined, sessionId: string | undefined;
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address === "object");
  const run = () => new Promise<{ code: number | null; outcome: string }>((resolve, reject) => {
    const child = spawn(process.env.PYTHON ?? "python", ["-m", "biometric_terminal", "check-in"], {
      cwd: fileURLToPath(new URL("../../biometric-terminal/", import.meta.url)),
      env: { ...process.env, DUOMARK_MODE: "express-development", DUOMARK_API_URL: `http://127.0.0.1:${address.port}/api/v1`, DUOMARK_TERMINAL_ID: terminalId, DUOMARK_DEVICE_TOKEN: credential },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", data => { output += data; });
    child.stderr.resume();
    child.on("error", reject);
    child.on("close", code => {
      try { resolve({ code, outcome: JSON.parse(output).outcome }); }
      catch { reject(new Error("Python CLI returned no structured result")); }
    });
  });
  try {
    for (const role of ["ADMIN", "LECTURER"] as const) staffIds.push((await prisma.staff.create({ data: { email: `py-${role}-${suffix}@example.test`, name: "Fictional Python fixture", role } })).id);
    courseId = (await prisma.course.create({ data: { code: `PY-${suffix}`.toUpperCase(), title: "Fictional Python course" } })).id;
    sectionId = (await prisma.classSection.create({ data: { courseId, lecturerId: staffIds[1], code: "PYTHON", room: "Test", schedule: "Test", academicYear: "2026/2027", term: "TEST", isFictional: true } })).id;
    await prisma.terminal.create({ data: { id: terminalId, name: "Fictional Python terminal", location: "Test", isFictional: true } });
    studentId = (await prisma.student.create({ data: { studentId: `PY-${suffix}`.toUpperCase(), name: "Fictional Python student", program: "Test", department: "Test", level: "100", classSectionId: sectionId, isFictional: true, faceEnrollment: "Enrolled", fingerprintEnrollment: "Enrolled" } })).id;
    await prisma.sectionRosterMembership.create({ data: { sectionId, studentId } });
    await prisma.studentConsent.create({ data: { studentId, verifiedById: staffIds[0] } });
    deviceId = (await prisma.developmentCheckInDevice.create({ data: { terminalId, credentialHash: digest(credential), fakeStudentId: studentId, fakeFaceOutcome: "MATCH", fakeFingerprintOutcome: "MATCH" } })).id;
    sessionId = (await prisma.attendanceSession.create({ data: { lecturerId: staffIds[1], sectionId, terminalId, courseId, courseCode: "PY", courseName: "Fictional", sectionCode: "PYTHON", room: "Test", academicYear: "2026/2027", term: "TEST" } })).id;
    const count = () => prisma.attendanceRecord.count({ where: { sessionId } });
    await prisma.developmentCheckInDevice.update({ where: { id: deviceId }, data: { fakeFaceOutcome: "NO_MATCH" } });
    assert.deepEqual(await run(), { code: 2, outcome: "face-retry" }); assert.equal(await count(), 0);
    await prisma.developmentCheckInDevice.update({ where: { id: deviceId }, data: { fakeFaceOutcome: "MATCH", fakeFingerprintOutcome: "NO_MATCH" } });
    assert.deepEqual(await run(), { code: 2, outcome: "verification-failed" }); assert.equal(await count(), 0);
    await prisma.developmentCheckInDevice.update({ where: { id: deviceId }, data: { fakeFingerprintOutcome: "MATCH" } });
    assert.deepEqual(await run(), { code: 0, outcome: "attendance-recorded" }); assert.equal(await count(), 1);
    assert.deepEqual(await run(), { code: 0, outcome: "already-recorded" }); assert.equal(await count(), 1);
    // Close while the backend is outside its transaction capturing fingerprint.
    developmentFingerprintVerifier.verify = async context => {
      await closeSession(sessionId!, staffIds[1]);
      return originalVerify.call(developmentFingerprintVerifier, context);
    };
    assert.deepEqual(await run(), { code: 2, outcome: "session-error" }); assert.equal(await count(), 1);
    assert.deepEqual(await run(), { code: 2, outcome: "session-error" }); assert.equal(await count(), 1);
  } finally {
    developmentFingerprintVerifier.verify = originalVerify;
    await new Promise<void>(resolve => server.close(() => resolve()));
    await prisma.auditEntry.deleteMany({ where: { OR: [{ deviceActorId: { in: deviceId ? [deviceId] : [] } }, { attendanceSessionId: { in: sessionId ? [sessionId] : [] } }] } });
    if (deviceId) {
      await prisma.faceVerificationAttempt.deleteMany({ where: { deviceId } });
      await prisma.attendanceRecord.deleteMany({ where: { deviceId } });
      await prisma.developmentCheckInDevice.delete({ where: { id: deviceId } });
    }
    if (sessionId) await prisma.attendanceSession.delete({ where: { id: sessionId } });
    if (studentId) {
      await prisma.sectionRosterMembership.deleteMany({ where: { studentId } });
      await prisma.studentConsent.deleteMany({ where: { studentId } });
      await prisma.student.delete({ where: { id: studentId } });
    }
    if (sectionId) await prisma.classSection.delete({ where: { id: sectionId } });
    await prisma.terminal.deleteMany({ where: { id: terminalId } });
    if (courseId) await prisma.course.delete({ where: { id: courseId } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    if (oldMode === undefined) delete process.env.CHECK_IN_MODE; else process.env.CHECK_IN_MODE = oldMode;
    if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv;
    await prisma.$disconnect();
  }
});
