import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { authConfig } from "../src/config/auth.js";
import { digest } from "../src/services/auth.service.js";
import { developmentFingerprintVerifier } from "../src/integrations/check-in.js";
import { closeSession, openSession } from "../src/services/attendance-session.service.js";
import { addRosterStudent, removeRosterStudent } from "../src/services/roster.service.js";
import { subscribeChanges } from "../src/services/events.service.js";

test("fingerprint completion: official register, safe retries, duplicate and close serialization", async () => {
  const oldMode = process.env.CHECK_IN_MODE;
  const oldEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  process.env.CHECK_IN_MODE = "development-fake";
  const originalVerify = developmentFingerprintVerifier.verify.bind(developmentFingerprintVerifier);
  const unique = randomUUID();
  const terminalId = `k-${unique}`;
  const notifications: { type: string; sessionId: string; terminalId: string }[] = [];
  const unsubscribeEvents = subscribeChanges(change => { if (change.terminalId === terminalId) notifications.push(change); });
  const staffIds: string[] = [];
  const deviceIds: string[] = [];
  const cookies: string[] = [];
  const credentials = [randomBytes(32).toString("base64url"), randomBytes(32).toString("base64url")];
  let studentId: string | undefined;
  let sectionId: string | undefined;
  let courseId: number | undefined;
  let currentSessionId = "";
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const check = (step: string, body?: unknown, device = 0, headers: Record<string, string> = {}) => fetch(`${base}/terminals/${terminalId}/check-ins/${step}-verification`, {
    method: "POST", headers: { Authorization: `Bearer ${credentials[device]}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const face = async (device = 0) => {
    const response = await check("face", undefined, device);
    assert.equal(response.status, 201);
    return (await response.json()).attemptId as string;
  };
  const fingerprint = (attemptId: string, device = 0) => check("fingerprint", { attemptId }, device);
  const records = () => prisma.attendanceRecord.count({ where: { sessionId: currentSessionId } });
  const newSession = async () => {
    if (currentSessionId) await closeSession(currentSessionId, staffIds[1]);
    currentSessionId = (await openSession({ sectionId: sectionId!, terminalId }, staffIds[1])).id;
  };
  try {
    for (const role of ["ADMIN", "LECTURER"] as const) {
      const staff = await prisma.staff.create({ data: { email: `${role}-fingerprint-${unique}@example.test`, name: "Fictional fingerprint verifier", role } });
      staffIds.push(staff.id);
      const token = randomBytes(32).toString("base64url");
      cookies.push(`${authConfig.cookieName}=${token}`);
      await prisma.staffSession.create({ data: { staffId: staff.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 60000) } });
    }
    const course = await prisma.course.create({ data: { code: `PRINT-${unique}`.toUpperCase(), title: "Fictional Fingerprint Course" } });
    courseId = course.id;
    const section = await prisma.classSection.create({ data: { courseId, lecturerId: staffIds[1], code: "FICTIONAL A", room: "Test", schedule: "Test", academicYear: "2026/2027", term: "TEST", isFictional: true } });
    sectionId = section.id;
    await prisma.terminal.create({ data: { id: terminalId, name: "Fictional fingerprint station", location: "Test", isFictional: true } });
    const student = await prisma.student.create({ data: { studentId: `PRINT-${unique}`.toUpperCase(), name: "Fictional original name", program: "Test", department: "Test", level: "100", classSectionId: sectionId, isFictional: true, faceEnrollment: "Enrolled", fingerprintEnrollment: "Enrolled" } });
    studentId = student.id;
    await prisma.studentConsent.create({ data: { studentId, verifiedById: staffIds[0], consentReference: "Fictional consent" } });
    await addRosterStudent(sectionId, studentId, staffIds[0]);
    for (const credential of credentials) {
      const device = await prisma.developmentCheckInDevice.create({ data: { terminalId, credentialHash: digest(credential), fakeStudentId: studentId, fakeFaceOutcome: "MATCH", fakeFingerprintOutcome: "MATCH" } });
      deviceIds.push(device.id);
    }
    await newSession();
    const firstToken = await face();
    const missingDevice = await fetch(`${base}/terminals/${terminalId}/check-ins/fingerprint-verification`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookies[0] }, body: JSON.stringify({ attemptId: firstToken }) });
    assert.equal(missingDevice.status, 401);
    assert.equal((await missingDevice.json()).outcome, "device-error");
    assert.equal((await fingerprint(firstToken, 1)).status, 403); // different authenticated device on the SAME station
    assert.equal(await records(), 0);
    for (const bad of [{}, { attemptId: "bad" }, { attemptId: firstToken, matched: true }, { attemptId: firstToken, score: 1 }, { attemptId: firstToken, studentId }, { attemptId: firstToken, template: "forbidden" }]) {
      const response = await check("fingerprint", bad);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).outcome, "invalid-request");
    }
    let captures = 0;
    developmentFingerprintVerifier.verify = async context => { captures++; return originalVerify(context); };
    const first = await fingerprint(firstToken);
    assert.equal(first.status, 201);
    assert.equal(first.headers.get("cache-control"), "no-store");
    const firstBody = await first.json();
    assert.equal(firstBody.outcome, "attendance-recorded");
    assert.equal(firstBody.replayed, false);
    assert.equal(firstBody.developmentOnly, true);
    assert.deepEqual(Object.keys(firstBody.attendance).sort(), ["id", "recordedAt"]);
    const replay = await fingerprint(firstToken);
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), { ...firstBody, replayed: true });
    assert.equal(captures, 1); // no new capture or mutation on a completed retry
    developmentFingerprintVerifier.verify = originalVerify;
    const firstRow = await prisma.attendanceRecord.findUniqueOrThrow({ where: { sessionId_studentId: { sessionId: currentSessionId, studentId } } });
    assert.equal(firstRow.deviceId, deviceIds[0]);
    assert.equal(firstRow.terminalId, terminalId);
    assert.equal(firstRow.studentName, student.name);
    const audit = await prisma.auditEntry.findFirstOrThrow({ where: { attendanceRecordId: firstRow.id, action: "ATTENDANCE_RECORDED" } });
    assert.equal(audit.actorId, null);
    assert.equal(audit.deviceActorId, deviceIds[0]);
    assert.equal(await prisma.auditEntry.count({ where: { attendanceRecordId: firstRow.id } }), 1);
    assert.deepEqual(notifications.filter(change => change.type === "attendance-recorded"), [{ type: "attendance-recorded", sessionId: currentSessionId, terminalId }]);
    const auditHistory = await fetch(`${base}/admin/audit-events?actorType=device&actorId=${deviceIds[0]}&targetType=attendance-record&targetId=${firstRow.id}`, { headers: { Cookie: cookies[0] } });
    assert.equal(auditHistory.status, 200);
    const history = await auditHistory.json();
    assert.equal(history.pagination.total, 1);
    assert.equal(history.auditEvents[0].actorDetails.type, "device");
    assert.equal(history.auditEvents[0].actorDetails.id, deviceIds[0]);
    assert.equal(history.auditEvents[0].actorDetails.terminalId, terminalId);
    const auditDetail = await (await fetch(`${base}/admin/audit-events/${audit.id}`, { headers: { Cookie: cookies[0] } })).json();
    assert.deepEqual(auditDetail.event.metadata, { sessionId: currentSessionId, serviceId: "development-fake-fingerprint-capture", developmentOnly: true });
    assert.ok(!JSON.stringify(auditDetail).includes(firstToken));
    const duplicateToken = await face(1);
    const duplicate = await fingerprint(duplicateToken, 1);
    assert.equal(duplicate.status, 200);
    const duplicateBody = await duplicate.json();
    assert.equal(duplicateBody.outcome, "already-recorded");
    assert.deepEqual(duplicateBody.attendance, firstBody.attendance);
    assert.equal((await (await fingerprint(duplicateToken, 1)).json()).replayed, true);
    assert.equal(notifications.filter(change => change.type === "attendance-recorded" && change.sessionId === currentSessionId).length, 1);
    assert.equal(await records(), 1);
    const { id: _recordId, ...directDuplicate } = firstRow;
    await assert.rejects(prisma.attendanceRecord.create({ data: directDuplicate }));
    await removeRosterStudent(sectionId, studentId, staffIds[0]);
    await prisma.student.update({ where: { id: studentId }, data: { name: "Changed after attendance" } });
    await closeSession(currentSessionId, staffIds[1]);
    await prisma.faceVerificationAttempt.update({ where: { tokenHash: digest(firstToken) }, data: { createdAt: new Date(Date.now() - 180000), expiresAt: new Date(Date.now() - 1000) } });
    assert.deepEqual(await (await fingerprint(firstToken)).json(), { ...firstBody, replayed: true }); // after expiry, close and roster removal
    const register = await (await fetch(`${base}/lecturer/sessions/${currentSessionId}`, { headers: { Cookie: cookies[1] } })).json();
    assert.equal(register.session.attendance.length, 1);
    assert.equal(register.session.attendance[0].studentName, student.name); // immutable register snapshot
    assert.deepEqual(Object.keys(register.session.attendance[0]).sort(), ["developmentOnly", "id", "indexNumber", "recordedAt", "sessionId", "status", "studentId", "studentName"]);
    const adminRegister = await (await fetch(`${base}/admin/sessions/${currentSessionId}`, { headers: { Cookie: cookies[0] } })).json();
    assert.deepEqual(adminRegister.session.attendance, register.session.attendance);
    await addRosterStudent(sectionId, studentId, staffIds[0]);

    await newSession();
    const mismatchToken = await face();
    await prisma.developmentCheckInDevice.update({ where: { id: deviceIds[0] }, data: { fakeFingerprintOutcome: "NO_MATCH" } });
    const mismatch = await fingerprint(mismatchToken);
    assert.equal(mismatch.status, 422);
    assert.equal((await mismatch.json()).outcome, "verification-failed");
    assert.equal(notifications.filter(change => change.type === "attendance-recorded" && change.sessionId === currentSessionId).length, 0);
    assert.equal(await records(), 0);
    assert.equal((await prisma.faceVerificationAttempt.findUniqueOrThrow({ where: { tokenHash: digest(mismatchToken) } })).status, "INVALIDATED");
    await prisma.developmentCheckInDevice.update({ where: { id: deviceIds[0] }, data: { fakeFingerprintOutcome: "MATCH" } });
    assert.equal((await fingerprint(mismatchToken)).status, 409);
    const expiredToken = await face();
    await prisma.faceVerificationAttempt.update({ where: { tokenHash: digest(expiredToken) }, data: { createdAt: new Date(Date.now() - 180000), expiresAt: new Date(Date.now() - 1000) } });
    const expired = await fingerprint(expiredToken);
    assert.equal(expired.status, 410);
    assert.equal((await expired.json()).outcome, "attempt-expired");
    assert.equal(await records(), 0);
    const removedToken = await face();
    await removeRosterStudent(sectionId, studentId, staffIds[0]);
    assert.equal((await fingerprint(removedToken)).status, 422);
    assert.equal(await records(), 0);
    await addRosterStudent(sectionId, studentId, staffIds[0]);
    const ineligibleToken = await face();
    await prisma.student.update({ where: { id: studentId }, data: { fingerprintEnrollment: "Pending" } });
    assert.equal((await fingerprint(ineligibleToken)).status, 422);
    await prisma.student.update({ where: { id: studentId }, data: { fingerprintEnrollment: "Enrolled" } });
    const closedToken = await face();
    await closeSession(currentSessionId, staffIds[1]);
    const closed = await fingerprint(closedToken);
    assert.equal(closed.status, 409);
    assert.equal((await closed.json()).outcome, "session-error");
    assert.equal(await records(), 0);

    await newSession();
    const concurrentTokens = await Promise.all([face(0), face(1)]);
    const concurrent = await Promise.all(concurrentTokens.map((token, index) => fingerprint(token, index)));
    assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 201]);
    const outcomes = await Promise.all(concurrent.map(response => response.json()));
    assert.deepEqual(outcomes.map(body => body.outcome).sort(), ["already-recorded", "attendance-recorded"]);
    assert.equal(await records(), 1);
    const concurrentRecord = await prisma.attendanceRecord.findUniqueOrThrow({ where: { sessionId_studentId: { sessionId: currentSessionId, studentId } } });
    assert.equal(await prisma.auditEntry.count({ where: { attendanceRecordId: concurrentRecord.id } }), 1);
    await newSession();
    const sameToken = await face();
    const repeated = await Promise.all([fingerprint(sameToken), fingerprint(sameToken)]);
    assert.deepEqual(repeated.map(response => response.status).sort(), [200, 201]);
    assert.equal(await records(), 1);

    await newSession();
    const closureDuringCapture = await face();
    developmentFingerprintVerifier.verify = async context => {
      const result = await originalVerify(context);
      await closeSession(context.attendanceSessionId, staffIds[1]);
      return result;
    };
    assert.equal((await fingerprint(closureDuringCapture)).status, 409);
    assert.equal(await records(), 0); // close won before the final write
    developmentFingerprintVerifier.verify = originalVerify;
    await newSession();
    const raceToken = await face();
    const [raceResponse] = await Promise.all([fingerprint(raceToken), closeSession(currentSessionId, staffIds[1])]);
    assert.ok(raceResponse.status === 201 || raceResponse.status === 409);
    const committed = await records();
    assert.equal(committed, raceResponse.status === 201 ? 1 : 0);
    const closedRegister = await (await fetch(`${base}/lecturer/sessions/${currentSessionId}`, { headers: { Cookie: cookies[1] } })).json();
    assert.equal(closedRegister.session.status, "Closed");
    assert.equal(closedRegister.session.attendance.length, committed);
    await newSession();
    const tamperedToken = await face();
    developmentFingerprintVerifier.verify = async context => ({ ...await originalVerify(context), studentId: randomUUID() });
    const untrusted = await fingerprint(tamperedToken);
    assert.equal(untrusted.status, 409);
    assert.equal((await untrusted.json()).outcome, "device-error");
    assert.equal(await records(), 0);
    developmentFingerprintVerifier.verify = originalVerify;
    process.env.NODE_ENV = "production";
    const production = await fingerprint(tamperedToken);
    assert.equal(production.status, 503);
    assert.equal((await production.json()).outcome, "service-unavailable");
    process.env.NODE_ENV = "test";
    assert.equal((await fetch(`${base}/terminals/${terminalId}/session`)).status, 200);
    assert.equal((await fetch(base.replace("/api/v1", "/health"))).status, 200);
  } finally {
    unsubscribeEvents();
    developmentFingerprintVerifier.verify = originalVerify;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await prisma.auditEntry.deleteMany({ where: { OR: [{ actorId: { in: staffIds } }, { deviceActorId: { in: deviceIds } }] } });
    await prisma.faceVerificationAttempt.deleteMany({ where: { deviceId: { in: deviceIds } } });
    await prisma.attendanceRecord.deleteMany({ where: { deviceId: { in: deviceIds } } });
    await prisma.developmentCheckInDevice.deleteMany({ where: { id: { in: deviceIds } } });
    if (sectionId) {
      await prisma.attendanceSession.deleteMany({ where: { sectionId } });
      await prisma.sectionRosterMembership.deleteMany({ where: { sectionId } });
    }
    if (studentId) { await prisma.studentConsent.deleteMany({ where: { studentId } }); await prisma.student.delete({ where: { id: studentId } }); }
    if (sectionId) await prisma.classSection.delete({ where: { id: sectionId } });
    await prisma.terminal.deleteMany({ where: { id: terminalId } });
    if (courseId) await prisma.course.delete({ where: { id: courseId } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await prisma.$disconnect();
    if (oldMode === undefined) delete process.env.CHECK_IN_MODE; else process.env.CHECK_IN_MODE = oldMode;
    if (oldEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnvironment;
  }
});
