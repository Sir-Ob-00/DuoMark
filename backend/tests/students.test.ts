import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { authConfig } from "../src/config/auth.js";
import { digest } from "../src/services/auth.service.js";
import { createStudent, updateStudent, recordConsent } from "../src/services/student.service.js";

test("admin students, validation, consent attribution and atomic audit records", async () => {
  const unique = randomUUID();
  const prefix = `TEST-${unique}`.toUpperCase();
  const ids: string[] = [];
  const staffIds: string[] = [];
  const token = randomBytes(32).toString("base64url");
  const lecturerToken = randomBytes(32).toString("base64url");
  const cookie = `${authConfig.cookieName}=${token}`;
  const lecturerCookie = `${authConfig.cookieName}=${lecturerToken}`;
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/v1/admin/students`;
  const input = { studentId: prefix.toLowerCase(), name: `Student ${unique}`, program: "Computer Science", department: "Computing", level: "300", classSectionId: "section-1" };
  const request = (path = "", method = "GET", body?: unknown, auth = cookie) => fetch(base + path, {
    method, headers: { Origin: authConfig.origins[0], "X-CSRF-Protection": "1", Cookie: auth, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    for (const [role, value] of [["ADMIN", token], ["LECTURER", lecturerToken]] as const) {
      const staff = await prisma.staff.create({ data: { email: `${role}-${unique}@example.test`, name: "Student test", role, passwordHash: "not-a-login-hash" } });
      staffIds.push(staff.id);
      await prisma.staffSession.create({ data: { tokenHash: digest(value), staffId: staff.id, expiresAt: new Date(Date.now() + 60000) } });
    }
    // Real opaque sessions exercise the existing server-side authentication middleware.
    const missing = randomUUID();
    const routes = [["", "GET"], ["", "POST"], [`/${missing}`, "GET"], [`/${missing}`, "PATCH"], [`/${missing}/enrollment`, "GET"], [`/${missing}/enrollment/consent`, "POST"]];
    for (const [path, method] of routes) {
      assert.equal((await request(path, method, method === "POST" || method === "PATCH" ? {} : undefined, lecturerCookie)).status, 403);
      assert.equal((await request(path, method, method === "POST" || method === "PATCH" ? {} : undefined, "")).status, 401);
    }
    const create = await request("", "POST", input);
    assert.equal(create.status, 201);
    const student = (await create.json()).student;
    ids.push(student.id);
    assert.equal(student.studentId, prefix);
    assert.equal(student.enrollmentStatus, "Pending");
    assert.equal(create.headers.get("location"), `/api/v1/admin/students/${student.id}`);
    assert.equal((await request("", "POST", { ...input, studentId: prefix })).status, 409);
    assert.equal(await prisma.auditEntry.count({ where: { studentId: student.id } }), 1);
    for (const bad of [{ ...input, level: "0" }, { ...input, name: " " }, { ...input, studentId: "bad index" }, { ...input, faceEnrollment: "Enrolled" }, [], null]) {
      assert.equal((await request("", "POST", bad)).status, 400);
    }
    const secondResponse = await request("", "POST", { ...input, studentId: `${prefix}-2` });
    assert.equal(secondResponse.status, 201);
    const second = (await secondResponse.json()).student;
    ids.push(second.id);
    assert.equal((await request(`/${second.id}`, "PATCH", { studentId: prefix.toLowerCase() })).status, 409);
    const profile = await request(`/${student.id}`);
    assert.equal(profile.status, 200);
    assert.deepEqual((await profile.json()).student, student);
    const initialEnrollment = await request(`/${student.id}/enrollment`);
    assert.deepEqual((await initialEnrollment.json()).enrollment, { studentId: student.id, consentRecorded: false, face: "Pending", fingerprint: "Pending", consent: null });
    for (const bad of [{}, { role: "ADMIN" }, { faceEnrollment: "Enrolled" }, { consentRecorded: true }, { id: missing }, { level: 300 }]) {
      assert.equal((await request(`/${student.id}`, "PATCH", bad)).status, 400);
    }
    const patch = await request(`/${student.id}`, "PATCH", { name: "Updated Name", level: "400" });
    assert.equal(patch.status, 200);
    assert.equal((await patch.json()).student.level, "400");
    const audit = await prisma.auditEntry.findFirstOrThrow({ where: { studentId: student.id, action: "STUDENT_UPDATED" } });
    assert.equal(audit.actorId, staffIds[0]);
    assert.deepEqual(audit.details, { changedFields: ["name", "level"], before: { name: input.name, level: "300" }, after: { name: "Updated Name", level: "400" } });
    const list = await request(`?search=${prefix.toLowerCase()}&program=Computer%20Science&department=Computing&level=400&classSectionId=section-1&status=Pending&page=1&limit=1`);
    const results = await list.json();
    assert.equal(list.status, 200);
    assert.equal(results.students[0].id, student.id);
    assert.deepEqual(results.pagination, { page: 1, limit: 1, total: 1, totalPages: 1 });
    assert.equal((await (await request(`?search=${prefix}&status=Enrolled`)).json()).pagination.total, 0);
    for (const query of ["limit=101", "page=0", "page=1.5", "status=bad", "level=abc", "search[x]=y", "level=100&level=200", "unexpected=1"]) {
      assert.equal((await request(`?${query}`)).status, 400);
    }
    assert.equal((await request(`/${missing}`)).status, 404);
    assert.equal((await request(`/${missing}`, "PATCH", { name: "Missing" })).status, 404);
    assert.equal((await request(`/${missing}/enrollment`)).status, 404);
    assert.equal((await request(`/${missing}/enrollment/consent`, "POST", { consentVerified: true })).status, 404);
    assert.equal((await request("/not-a-uuid")).status, 400);
    for (const bad of [{}, { consentVerified: false }, { consentVerified: true, verifiedById: staffIds[1] }, { consentVerified: true, recordedAt: new Date().toISOString() }]) {
      assert.equal((await request(`/${student.id}/enrollment/consent`, "POST", bad)).status, 400);
    }
    const beforeConsent = Date.now();
    const consentResponse = await request(`/${student.id}/enrollment/consent`, "POST", { consentVerified: true, consentVersion: "biometric-v1", consentReference: "FORM-123" });
    assert.equal(consentResponse.status, 201);
    const enrollment = (await consentResponse.json()).enrollment;
    assert.equal(enrollment.consentRecorded, true);
    assert.equal(enrollment.face, "Pending");
    assert.equal(enrollment.fingerprint, "Pending");
    assert.equal(enrollment.consent.studentId, student.id);
    assert.equal(enrollment.consent.verifiedById, staffIds[0]);
    assert.equal(enrollment.consent.consentVersion, "biometric-v1");
    assert.equal(enrollment.consent.consentReference, "FORM-123");
    assert.ok(Date.parse(enrollment.consent.recordedAt) >= beforeConsent - 1000);
    const consentAudit = await prisma.auditEntry.findFirstOrThrow({ where: { studentId: student.id, action: "STUDENT_CONSENT_RECORDED" } });
    assert.equal(consentAudit.actorId, staffIds[0]);
    assert.equal((consentAudit.details as { consentId: string }).consentId, enrollment.consent.id);
    assert.deepEqual((await (await request(`/${student.id}/enrollment`)).json()).enrollment, enrollment);
    assert.equal((await request(`/${student.id}/enrollment/consent`, "POST", { consentVerified: true })).status, 201);
    assert.equal(await prisma.studentConsent.count({ where: { studentId: student.id } }), 2);
    // A failed audit insert must roll back its student operation.
    await assert.rejects(createStudent({ ...input, studentId: `${prefix}-ROLLBACK` }, missing));
    assert.equal(await prisma.student.count({ where: { studentId: `${prefix}-ROLLBACK` } }), 0);
    await assert.rejects(updateStudent(student.id, { name: "Must roll back" }, missing));
    assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: student.id } })).name, "Updated Name");
    await assert.rejects(recordConsent(student.id, { consentVersion: null, consentReference: null }, missing));
    assert.equal(await prisma.studentConsent.count({ where: { studentId: student.id } }), 2);
    // The database also rejects noncanonical index numbers outside the API.
    await assert.rejects(prisma.student.create({ data: { ...input, studentId: prefix.toLowerCase() } }));
    const preflight = await fetch(base, { method: "OPTIONS", headers: { Origin: authConfig.origins[0], "Access-Control-Request-Method": "PATCH" } });
    assert.ok(preflight.headers.get("access-control-allow-methods")?.includes("PATCH"));
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await prisma.auditEntry.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.studentConsent.deleteMany({ where: { verifiedById: { in: staffIds } } });
    await prisma.student.deleteMany({ where: { id: { in: ids } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await prisma.$disconnect();
  }
});
