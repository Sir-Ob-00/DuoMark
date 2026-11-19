import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { authConfig } from "../src/config/auth.js";
import { digest } from "../src/services/auth.service.js";
import { developmentFaceIdentifier } from "../src/integrations/check-in.js";
import { closeSession } from "../src/services/attendance-session.service.js";

test("device-only fictional face verification, eligibility, binding and no attendance writes", async () => {
  const oldMode = process.env.CHECK_IN_MODE;
  const oldEnvironment = process.env.NODE_ENV;
  const originalIdentify = developmentFaceIdentifier.identify.bind(developmentFaceIdentifier);
  process.env.NODE_ENV = "test";
  process.env.CHECK_IN_MODE = "development-fake";
  const unique = randomUUID();
  const terminalIds = [`v-${unique}`, `w-${unique}`];
  const staffIds: string[] = [];
  const studentIds: string[] = [];
  const deviceIds: string[] = [];
  const credentials = [randomBytes(32).toString("base64url"), randomBytes(32).toString("base64url")];
  const staffToken = randomBytes(32).toString("base64url");
  let courseId: number | undefined;
  let sectionId: string | undefined;
  let sessionId: string | undefined;
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const request = (station = terminalIds[0], credential: string | null = credentials[0], body?: unknown, headers: Record<string, string> = {}) => fetch(`${base}/terminals/${station}/check-ins/face-verification`, {
    method: "POST", headers: { ...(credential ? { Authorization: `Bearer ${credential}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const pending = () => prisma.faceVerificationAttempt.count({ where: { deviceId: deviceIds[0], status: "WAITING_FINGERPRINT" } });
  try {
    for (const role of ["ADMIN", "LECTURER"] as const) {
      const staff = await prisma.staff.create({ data: { email: `face-${role}-${unique}@example.test`, name: "Fictional verifier", role } });
      staffIds.push(staff.id);
    }
    await prisma.staffSession.create({ data: { staffId: staffIds[0], tokenHash: digest(staffToken), expiresAt: new Date(Date.now() + 60000) } });
    const course = await prisma.course.create({ data: { code: `FACE-${unique}`.toUpperCase(), title: "Fictional Face Course" } });
    courseId = course.id;
    const section = await prisma.classSection.create({ data: { courseId, lecturerId: staffIds[1], code: "FICTIONAL A", room: "Test", schedule: "Test", academicYear: "2026/2027", term: "TEST", isFictional: true } });
    sectionId = section.id;
    for (let i = 0; i < 2; i++) {
      await prisma.terminal.create({ data: { id: terminalIds[i], name: `Fictional ${i}`, location: "Test", isFictional: true } });
      const student = await prisma.student.create({ data: { studentId: `FACE-${i}-${unique}`.toUpperCase(), name: "Fictional private identity", program: "Test", department: "Test", level: "100", classSectionId: sectionId, isFictional: true, faceEnrollment: "Enrolled", fingerprintEnrollment: "Enrolled" } });
      studentIds.push(student.id);
      await prisma.sectionRosterMembership.create({ data: { sectionId, studentId: student.id } });
    }
    const consent = await prisma.studentConsent.create({ data: { studentId: studentIds[0], verifiedById: staffIds[0], consentReference: "Fictional" } });
    const session = await prisma.attendanceSession.create({ data: { courseId, sectionId, lecturerId: staffIds[1], terminalId: terminalIds[0], courseCode: course.code, courseName: course.title, sectionCode: section.code, room: section.room, academicYear: section.academicYear, term: section.term } });
    sessionId = session.id;
    for (let i = 0; i < 2; i++) {
      const device = await prisma.developmentCheckInDevice.create({ data: { terminalId: terminalIds[i], credentialHash: digest(credentials[i]), fakeStudentId: studentIds[0], fakeFaceOutcome: "MATCH" } });
      deviceIds.push(device.id);
    }
    assert.equal((await request(terminalIds[0], null)).status, 401);
    assert.equal((await request(terminalIds[0], null, undefined, { Cookie: `${authConfig.cookieName}=${staffToken}` })).status, 401);
    assert.equal((await request(terminalIds[0], randomBytes(32).toString("base64url"))).status, 401);
    assert.equal((await request(terminalIds[1], credentials[0])).status, 403);
    assert.equal((await request(terminalIds[0], credentials[1])).status, 403);
    assert.equal((await request(terminalIds[1], credentials[1])).status, 409); // no open session
    process.env.CHECK_IN_MODE = "disabled";
    assert.equal((await request()).status, 503);
    process.env.CHECK_IN_MODE = "development-fake";
    process.env.NODE_ENV = "production";
    assert.equal((await request()).status, 503);
    process.env.NODE_ENV = "test";
    assert.equal(await pending(), 0);
    const success = await request(); // no Origin, CSRF or staff cookie is needed for device credentials
    assert.equal(success.status, 201);
    assert.equal(success.headers.get("cache-control"), "no-store");
    assert.equal(success.headers.get("set-cookie"), null);
    const body = await success.json();
    assert.deepEqual(Object.keys(body).sort(), ["attemptId", "developmentOnly", "expiresAt", "nextStep"]);
    assert.ok(/^[A-Za-z0-9_-]{43}$/.test(body.attemptId));
    assert.equal(body.nextStep, "fingerprint-verification");
    assert.equal(body.developmentOnly, true);
    assert.ok(Date.parse(body.expiresAt) > Date.now());
    assert.ok(Date.parse(body.expiresAt) <= Date.now() + 120000);
    for (const privateValue of [...studentIds, ...staffIds, ...credentials]) assert.equal(JSON.stringify(body).includes(privateValue), false);
    const attempt = await prisma.faceVerificationAttempt.findUniqueOrThrow({ where: { tokenHash: digest(body.attemptId) } });
    assert.equal(attempt.deviceId, deviceIds[0]);
    assert.equal(attempt.terminalId, terminalIds[0]);
    assert.equal(attempt.attendanceSessionId, sessionId);
    assert.equal(attempt.studentId, studentIds[0]);
    assert.equal(attempt.consentId, consent.id);
    assert.equal(attempt.status, "WAITING_FINGERPRINT");
    assert.equal(attempt.developmentOnly, true);
    assert.equal(JSON.stringify(attempt).includes(body.attemptId), false);
    assert.equal(await prisma.attendanceSession.count({ where: { sectionId } }), 1);
    assert.equal(await prisma.auditEntry.count({ where: { actorId: { in: staffIds } } }), 0); // no staff actor impersonation
    for (const supplied of [{ studentId: studentIds[0] }, { indexNumber: "FAKE" }, { matched: true }, { success: true }, { score: 1 }, { outcome: "MATCH" }, { template: "forbidden" }, { sample: "forbidden" }, { deviceId: deviceIds[0] }, { sessionId }]) {
      assert.equal((await request(terminalIds[0], credentials[0], supplied)).status, 400);
    }
    const raw = await fetch(`${base}/terminals/${terminalIds[0]}/check-ins/face-verification`, { method: "POST", headers: { Authorization: `Bearer ${credentials[0]}`, "Content-Type": "application/octet-stream" }, body: "not-an-accepted-sample" });
    assert.equal(raw.status, 400);
    // A failed new face capture invalidates the prior successful face handle.
    await prisma.developmentCheckInDevice.update({ where: { id: deviceIds[0] }, data: { fakeFaceOutcome: "NO_MATCH" } });
    assert.equal((await request()).status, 422);
    assert.equal(await pending(), 0);
    assert.equal((await prisma.faceVerificationAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status, "INVALIDATED");
    await prisma.developmentCheckInDevice.update({ where: { id: deviceIds[0] }, data: { fakeFaceOutcome: "MATCH", fakeStudentId: studentIds[1] } });
    assert.equal((await request()).status, 422); // no consent
    assert.equal(await pending(), 0);
    await prisma.studentConsent.create({ data: { studentId: studentIds[1], verifiedById: staffIds[0] } });
    for (const flags of [{ faceEnrollment: "Pending" as const }, { faceEnrollment: "Enrolled" as const, fingerprintEnrollment: "Pending" as const }]) {
      await prisma.student.update({ where: { id: studentIds[1] }, data: flags });
      assert.equal((await request()).status, 422);
      assert.equal(await pending(), 0);
    }
    await prisma.student.update({ where: { id: studentIds[1] }, data: { faceEnrollment: "Enrolled", fingerprintEnrollment: "Enrolled", isFictional: false } });
    assert.equal((await request()).status, 422); // no real student can be identified by this fake
    await prisma.student.update({ where: { id: studentIds[1] }, data: { isFictional: true } });
    await prisma.sectionRosterMembership.delete({ where: { sectionId_studentId: { sectionId, studentId: studentIds[1] } } });
    assert.equal((await request()).status, 422); // match candidate outside current roster
    await prisma.sectionRosterMembership.create({ data: { sectionId, studentId: studentIds[1] } });
    const deletion = await prisma.captureAttempt.create({ data: { requestId: randomUUID(), studentId: studentIds[1], modality: "face", operation: "REMOVE", actorId: staffIds[0], serviceId: "development-fake-capture", deviceId: "development-fake-device" } });
    assert.equal((await request()).status, 422); // enrolled metadata cannot bypass a pending deletion
    await prisma.captureAttempt.delete({ where: { id: deletion.id } });
    await prisma.classSection.update({ where: { id: sectionId }, data: { isFictional: false } });
    assert.equal((await request()).status, 503);
    await prisma.classSection.update({ where: { id: sectionId }, data: { isFictional: true } });
    await prisma.terminal.update({ where: { id: terminalIds[0] }, data: { isFictional: false } });
    assert.equal((await request()).status, 401);
    await prisma.terminal.update({ where: { id: terminalIds[0] }, data: { isFictional: true, status: "Unavailable" } });
    assert.equal((await request()).status, 201); // an existing OPEN session continues while Unavailable
    const concurrent = await Promise.all([request(), request()]);
    assert.ok(concurrent.every(response => response.status === 201 || response.status === 409));
    assert.equal(await pending(), 1);
    developmentFaceIdentifier.identify = async context => ({ ...await originalIdentify(context), serviceId: "untrusted" });
    assert.equal((await request()).status, 409);
    assert.equal(await pending(), 0);
    developmentFaceIdentifier.identify = async context => {
      await closeSession(sessionId!, staffIds[1]);
      return originalIdentify(context);
    };
    assert.equal((await request()).status, 409); // closure during capture cannot issue an advancing attempt
    assert.equal(await pending(), 0);
    developmentFaceIdentifier.identify = originalIdentify;
    assert.equal((await request()).status, 409);
    const display = await fetch(`${base}/terminals/${terminalIds[0]}/session`);
    assert.equal(display.status, 200);
    assert.equal((await display.json()).activeSession, null);
    assert.equal((await fetch(base.replace("/api/v1", "/health"))).status, 200);
  } finally {
    developmentFaceIdentifier.identify = originalIdentify;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await prisma.faceVerificationAttempt.deleteMany({ where: { deviceId: { in: deviceIds } } });
    await prisma.developmentCheckInDevice.deleteMany({ where: { id: { in: deviceIds } } });
    await prisma.captureAttempt.deleteMany({ where: { studentId: { in: studentIds } } });
    await prisma.auditEntry.deleteMany({ where: { actorId: { in: staffIds } } });
    if (sectionId) {
      await prisma.attendanceSession.deleteMany({ where: { sectionId } });
      await prisma.sectionRosterMembership.deleteMany({ where: { sectionId } });
    }
    await prisma.studentConsent.deleteMany({ where: { studentId: { in: studentIds } } });
    await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
    if (sectionId) await prisma.classSection.delete({ where: { id: sectionId } });
    await prisma.terminal.deleteMany({ where: { id: { in: terminalIds } } });
    if (courseId) await prisma.course.delete({ where: { id: courseId } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await prisma.$disconnect();
    if (oldMode === undefined) delete process.env.CHECK_IN_MODE; else process.env.CHECK_IN_MODE = oldMode;
    if (oldEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnvironment;
  }
});
