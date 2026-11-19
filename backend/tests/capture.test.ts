import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { authConfig } from "../src/config/auth.js";
import { digest } from "../src/services/auth.service.js";
import { completeCaptureCommand } from "../src/services/capture.service.js";
import { confirmDevelopmentAttempt } from "../src/integrations/development-fake.js";
import { fakeCaptureService, type CaptureConfirmation } from "../src/integrations/capture-service.js";

test("biometric workflow, trusted fake completion, replay safety and deletion audit", async () => {
  const oldMode = process.env.BIOMETRIC_CAPTURE_MODE;
  const oldEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  process.env.BIOMETRIC_CAPTURE_MODE = "development-fake";
  const unique = randomUUID();
  const staffIds: string[] = [];
  const studentIds: string[] = [];
  const adminToken = randomBytes(32).toString("base64url");
  const lecturerToken = randomBytes(32).toString("base64url");
  const adminCookie = `${authConfig.cookieName}=${adminToken}`;
  const lecturerCookie = `${authConfig.cookieName}=${lecturerToken}`;
  const deviceId = fakeCaptureService.deviceIds[0];
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/v1/admin/students`;
  let studentId = "";
  let index = "";
  const request = (modality: string, method: string, body: unknown, cookie = adminCookie) => fetch(`${base}/${studentId}/enrollment/${modality}`, {
    method, headers: { Origin: authConfig.origins[0], "X-CSRF-Protection": "1", "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body),
  });
  const startBody = () => ({ requestId: randomUUID(), deviceId, identityVerified: true, studentIndexNumber: index });
  const deletionBody = (action = "reset") => ({ requestId: randomUUID(), deviceId, action });
  const enrollment = async () => (await (await fetch(`${base}/${studentId}/enrollment`, { headers: { Cookie: adminCookie } })).json()).enrollment;
  async function confirmation(attemptId: string): Promise<CaptureConfirmation> {
    const attempt = await prisma.captureAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    return { attemptId, studentId: attempt.studentId, modality: attempt.modality, operation: attempt.operation, deviceId: attempt.deviceId,
      eventId: `fake:${attemptId}`, consentId: attempt.consentId, identityIndexNumber: attempt.identityIndexNumber,
      identityVerified: attempt.operation === "ENROLL", deletionConfirmed: attempt.operation !== "ENROLL" };
  }
  try {
    for (const [role, token] of [["ADMIN", adminToken], ["LECTURER", lecturerToken]] as const) {
      const staff = await prisma.staff.create({ data: { email: `${role}-capture-${unique}@example.test`, name: "Capture test", role, passwordHash: "not-a-login-hash" } });
      staffIds.push(staff.id);
      await prisma.staffSession.create({ data: { tokenHash: digest(token), staffId: staff.id, expiresAt: new Date(Date.now() + 60000) } });
    }
    index = `BIO-${unique}`.toUpperCase();
    const student = await prisma.student.create({ data: { studentId: index, name: "Capture Student", program: "Computing", department: "Science", level: "300", classSectionId: "section-1" } });
    studentId = student.id;
    studentIds.push(studentId);
    for (const method of ["POST", "DELETE"]) {
      assert.equal((await request("face", method, startBody(), lecturerCookie)).status, 403);
      assert.equal((await request("face", method, startBody(), "")).status, 401);
      assert.equal((await request("iris", method, method === "POST" ? startBody() : deletionBody())).status, 400);
    }
    assert.equal((await request("face", "POST", startBody())).status, 409); // no consent
    const consent = await prisma.studentConsent.create({ data: { studentId, verifiedById: staffIds[0], consentVersion: "test-v1" } });
    assert.equal((await request("face", "POST", { ...startBody(), studentIndexNumber: "WRONG-STUDENT" })).status, 409);
    assert.equal((await request("face", "POST", { ...startBody(), identityVerified: false })).status, 400);
    assert.equal((await request("face", "POST", { ...startBody(), deviceId: "unapproved" })).status, 400);
    for (const field of ["success", "outcome", "sample", "template", "samples", "templates", "verifiedById", "serviceId"]) {
      assert.equal((await request("face", "POST", { ...startBody(), [field]: "not-accepted" })).status, 400);
      assert.equal((await request("face", "DELETE", { ...deletionBody(), [field]: "not-accepted" })).status, 400);
    }
    process.env.BIOMETRIC_CAPTURE_MODE = "disabled";
    assert.equal((await request("face", "POST", startBody())).status, 503);
    assert.equal((await request("face", "DELETE", deletionBody())).status, 503);
    process.env.BIOMETRIC_CAPTURE_MODE = "development-fake";
    process.env.NODE_ENV = "production";
    assert.equal((await request("face", "POST", startBody())).status, 503);
    process.env.NODE_ENV = "development";
    assert.equal(await prisma.captureAttempt.count({ where: { studentId } }), 0);

    const body = startBody();
    const started = await request("face", "POST", body);
    assert.equal(started.status, 202);
    const start = await started.json();
    assert.equal(start.developmentOnly, true);
    const attemptId = start.attempt.id;
    assert.equal(start.attempt.status, "REQUESTED");
    assert.equal((await enrollment()).face, "Pending");
    const replay = await request("face", "POST", body);
    assert.equal(replay.status, 202);
    assert.equal((await replay.json()).attempt.id, attemptId);
    assert.equal((await request("fingerprint", "POST", body)).status, 409);
    assert.equal((await request("face", "POST", startBody())).status, 409);
    assert.equal(await prisma.captureAttempt.count({ where: { studentId } }), 1);
    const bound = await confirmation(attemptId);
    assert.equal(bound.consentId, consent.id);
    await assert.rejects(completeCaptureCommand(bound, "untrusted-service"));
    for (const mismatch of [{ deviceId: "other-device" }, { modality: "fingerprint" as const }, { operation: "RESET" as const }, { consentId: null }, { identityVerified: false }, { identityIndexNumber: "OTHER" }]) {
      await assert.rejects(completeCaptureCommand({ ...bound, ...mismatch }, fakeCaptureService.serviceId));
    }
    const completed = await confirmDevelopmentAttempt(attemptId);
    assert.equal(completed.status, "COMPLETED");
    assert.equal((await enrollment()).face, "Enrolled");
    await Promise.all([confirmDevelopmentAttempt(attemptId), confirmDevelopmentAttempt(attemptId)]);
    assert.equal(await prisma.auditEntry.count({ where: { studentId, action: "BIOMETRIC_COMPLETED" } }), 1);
    const historyResponse = await fetch(`${base.replace("/admin/students", "/admin/audit-events")}?eventType=BIOMETRIC_COMPLETED&targetType=student&targetId=${studentId}`, { headers: { Cookie: adminCookie } });
    assert.equal(historyResponse.status, 200);
    const history = await historyResponse.json();
    assert.equal(history.pagination.total, 1);
    assert.equal(history.auditEvents[0].actorDetails.id, staffIds[0]);
    const detail = await (await fetch(`${base.replace("/admin/students", "/admin/audit-events")}/${history.auditEvents[0].id}`, { headers: { Cookie: adminCookie } })).json();
    assert.equal(detail.event.metadata.completingServiceId, fakeCaptureService.serviceId);
    assert.equal(detail.event.metadata.completingDeviceId, deviceId);
    assert.ok(!("confirmationEventId" in detail.event.metadata));
    await assert.rejects(completeCaptureCommand({ ...bound, eventId: "different-event" }, fakeCaptureService.serviceId));
    assert.equal((await request("face", "POST", startBody())).status, 409);
    const resetBody = deletionBody();
    const reset = await request("face", "DELETE", resetBody);
    assert.equal(reset.status, 202);
    const resetId = (await reset.json()).attempt.id;
    assert.equal((await enrollment()).face, "Enrolled"); // not removed merely on browser request
    assert.equal((await request("face", "POST", startBody())).status, 409);
    const resetConfirmation = await confirmation(resetId);
    await assert.rejects(completeCaptureCommand({ ...resetConfirmation, deletionConfirmed: false }, fakeCaptureService.serviceId));
    await confirmDevelopmentAttempt(resetId);
    await confirmDevelopmentAttempt(resetId);
    assert.equal((await enrollment()).face, "Pending");
    await confirmDevelopmentAttempt(attemptId); // late replay cannot resurrect the deleted enrollment
    assert.equal((await enrollment()).face, "Pending");
    const resetAudit = await prisma.auditEntry.findFirstOrThrow({ where: { studentId, action: "BIOMETRIC_COMPLETED", details: { path: ["attemptId"], equals: resetId } } });
    assert.equal(resetAudit.actorId, staffIds[0]);
    assert.deepEqual(resetAudit.details, { attemptId: resetId, modality: "face", operation: "RESET", serviceId: fakeCaptureService.serviceId, deviceId,
      consentId: null, completingServiceId: fakeCaptureService.serviceId, completingDeviceId: deviceId, confirmationEventId: `fake:${resetId}`, deletionConfirmed: true, developmentOnly: true });
    assert.equal(await prisma.auditEntry.count({ where: { studentId, action: "BIOMETRIC_COMPLETED" } }), 2);

    const pending = await request("fingerprint", "POST", startBody());
    const pendingId = (await pending.json()).attempt.id;
    const removal = await request("fingerprint", "DELETE", deletionBody("remove"));
    assert.equal(removal.status, 202);
    const removalId = (await removal.json()).attempt.id;
    await assert.rejects(confirmDevelopmentAttempt(pendingId));
    assert.equal((await prisma.captureAttempt.findUniqueOrThrow({ where: { id: pendingId } })).status, "CANCELLED");
    assert.equal(await prisma.auditEntry.count({ where: { studentId, action: "BIOMETRIC_CANCELLED" } }), 1);
    await confirmDevelopmentAttempt(removalId);
    assert.equal((await enrollment()).fingerprint, "Pending");

    const changedIdentity = await request("face", "POST", startBody());
    const changedId = (await changedIdentity.json()).attempt.id;
    await prisma.student.update({ where: { id: studentId }, data: { studentId: `${index}-X` } });
    await assert.rejects(confirmDevelopmentAttempt(changedId));
    await prisma.student.update({ where: { id: studentId }, data: { studentId: index } });
    await prisma.captureAttempt.update({ where: { id: changedId }, data: { expiresAt: new Date(0) } });
    await assert.rejects(confirmDevelopmentAttempt(changedId));
    const replacement = await request("face", "POST", startBody());
    assert.equal(replacement.status, 202);
    const replacementId = (await replacement.json()).attempt.id;
    // Completion rechecks the consent's student binding rather than trusting the callback.
    const otherStudent = await prisma.student.create({ data: { studentId: `${index}-OTHER`, name: "Other Student", program: "Computing", department: "Science", level: "300", classSectionId: "section-1" } });
    studentIds.push(otherStudent.id);
    const otherConsent = await prisma.studentConsent.create({ data: { studentId: otherStudent.id, verifiedById: staffIds[0] } });
    await prisma.captureAttempt.update({ where: { id: replacementId }, data: { consentId: otherConsent.id } });
    await assert.rejects(confirmDevelopmentAttempt(replacementId));
    await prisma.captureAttempt.update({ where: { id: replacementId }, data: { consentId: consent.id } });
    // Production disables even the operator fake-completion entry point.
    process.env.NODE_ENV = "production";
    await assert.rejects(confirmDevelopmentAttempt(replacementId));
    process.env.NODE_ENV = "development";
    const state = await enrollment();
    assert.equal(state.face, "Pending");
    assert.ok(state.attempts.length > 0);
    assert.ok(!JSON.stringify(state).includes("passwordHash"));
    assert.equal((await fetch(base.replace("/api/v1/admin/students", "/health"))).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await prisma.captureAttempt.deleteMany({ where: { studentId: { in: studentIds } } });
    await prisma.auditEntry.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.studentConsent.deleteMany({ where: { studentId: { in: studentIds } } });
    await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await prisma.$disconnect();
    if (oldMode === undefined) delete process.env.BIOMETRIC_CAPTURE_MODE; else process.env.BIOMETRIC_CAPTURE_MODE = oldMode;
    if (oldEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnvironment;
  }
});
