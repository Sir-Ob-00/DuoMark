import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { authConfig } from "../src/config/auth.js";
import { digest } from "../src/services/auth.service.js";
import { recordConsent } from "../src/services/student.service.js";
import { approvedAuditMetadata } from "../src/services/audit.projection.js";

test("audit history: authorized filters, boundaries, attribution, redaction and retry safety", async () => {
  const unique = randomUUID();
  const staffIds: string[] = [], cookies: string[] = [];
  let studentId: string | undefined;
  let deviceId: string | undefined;
  const terminalId = `a-${unique}`;
  const canary = `SECRET-${unique}`;
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/v1/admin/audit-events`;
  const get = (suffix = "", cookie = cookies[0]) => fetch(base + suffix, { headers: cookie ? { Cookie: cookie } : {} });
  try {
    for (let i = 0; i < 2; i++) {
      const staff = await prisma.staff.create({ data: { name: `Audit actor ${unique} ${i}`, email: `audit-${i}-${unique}@example.test`, role: i ? "LECTURER" : "ADMIN", passwordHash: canary } });
      staffIds.push(staff.id);
      const token = randomBytes(32).toString("base64url");
      cookies.push(`${authConfig.cookieName}=${token}`);
      await prisma.staffSession.create({ data: { staffId: staff.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 60000) } });
    }
    const student = await prisma.student.create({ data: { studentId: `AUDIT-${unique}`.toUpperCase(), name: `Audit target ${unique}`, program: "Test", department: "Test", level: "100", classSectionId: "test", isFictional: true } });
    studentId = student.id;
    await prisma.terminal.create({ data: { id: terminalId, name: "Audit station", location: "Test", isFictional: true } });
    deviceId = (await prisma.developmentCheckInDevice.create({ data: { terminalId, credentialHash: digest(canary) } })).id;
    const times = ["2026-03-01T23:59:59.999Z", "2026-03-02T00:00:00.000Z", "2026-03-02T12:00:00.000Z", "2026-03-02T12:00:00.000Z", "2026-03-02T23:59:59.999Z", "2026-03-03T00:00:00.000Z"];
    const events = [];
    for (const timestamp of times) events.push(await prisma.auditEntry.create({ data: {
      actorId: staffIds[0], studentId, action: "STUDENT_UPDATED", timestamp: new Date(timestamp),
      details: { changedFields: ["name", "password", "score", "name"], before: { name: canary }, after: { name: canary },
        password: canary, passwordHash: canary, sessionToken: canary, deviceSecret: canary, sample: canary, template: canary, score: 0.99, nested: { secret: canary } },
    } }));
    const scope = `actorId=${staffIds[0]}&targetType=student&targetId=${studentId}`;
    const filters = `${scope}&actorType=staff&eventType=STUDENT_UPDATED&actor=${encodeURIComponent(unique)}&target=${encodeURIComponent(student.studentId)}&action=updated&search=${encodeURIComponent(student.name)}&dateFrom=2026-03-02&dateTo=2026-03-02`;
    const response = await get(`?${filters}&limit=2`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const first = await response.json();
    const second = await (await get(`?${filters}&limit=2&page=2`)).json();
    assert.deepEqual(first.pagination, { page: 1, limit: 2, total: 4, totalPages: 2 });
    const expected = events.slice(1, 5).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime() || b.id.localeCompare(a.id));
    const rows = [...first.auditEvents, ...second.auditEvents];
    assert.deepEqual(rows.map(row => row.id), expected.map(row => row.id));
    assert.deepEqual(Object.keys(rows[0]).sort(), ["action", "actor", "actorDetails", "eventType", "id", "target", "targetDetails", "timestamp"]);
    assert.deepEqual(rows[0].actorDetails, { type: "staff", id: staffIds[0], name: `Audit actor ${unique} 0` });
    assert.equal(rows[0].targetDetails.id, studentId);
    const detail = await get(`/${events[0].id}`);
    assert.equal(detail.status, 200);
    const body = await detail.json();
    assert.deepEqual(body.event.metadata, { changedFields: ["name"] });
    assert.ok(!JSON.stringify(body).includes(canary));
    assert.ok(!JSON.stringify(body).includes("@example.test"));
    assert.ok(!JSON.stringify(first).includes(canary));
    for (const key of ["search", "actor", "target"]) assert.equal((await (await get(`?${scope}&${key}=${canary}`)).json()).pagination.total, 0);
    assert.equal((await (await get(`?${scope}&actorType=device`)).json()).pagination.total, 0);
    assert.equal((await (await get(`?${scope}&eventType=STUDENT_CREATED`)).json()).pagination.total, 0);
    assert.equal((await get(`/${randomUUID()}`)).status, 404);
    for (const query of ["page=0", "limit=101", "actorId=bad", "eventType=BAD", "actorType=browser", "targetId=bad", "targetType=student&targetId=bad", "dateFrom=2026-02-30", "dateFrom=2026-03-03&dateTo=2026-03-02", "search=a&search=b", "details=secret"]) assert.equal((await get(`?${query}`)).status, 400);
    assert.equal((await get("/bad")).status, 400);
    for (const suffix of ["", `/${events[0].id}`]) {
      assert.equal((await get(suffix, cookies[1])).status, 403);
      assert.equal((await get(suffix, "")).status, 401);
      assert.equal((await fetch(base + suffix, { headers: { Authorization: `Bearer ${canary}` } })).status, 401);
    }
    // A browser cannot submit arbitrary audit events, even with admin auth/CSRF.
    const count = await prisma.auditEntry.count();
    const submitted = await fetch(base, { method: "POST", headers: { Cookie: cookies[0], Origin: authConfig.origins[0]!, "X-CSRF-Protection": "1", "Content-Type": "application/json" }, body: JSON.stringify({ eventType: "STUDENT_UPDATED" }) });
    assert.equal(submitted.status, 404);
    assert.equal(await prisma.auditEntry.count(), count);
    // Exercise the actual consent writer concurrently: one verification/audit.
    const consent = { consentVersion: "v1", consentReference: canary };
    const results = await Promise.all([recordConsent(studentId, consent, staffIds[0]), recordConsent(studentId, consent, staffIds[0])]);
    assert.equal(results[0].consent!.id, results[1].consent!.id);
    assert.equal(await prisma.studentConsent.count({ where: { studentId } }), 1);
    const consentEvents = await (await get(`?${scope}&action=enrollment`)).json();
    assert.equal(consentEvents.pagination.total, 1);
    assert.equal(consentEvents.auditEvents[0].eventType, "STUDENT_CONSENT_RECORDED");
    assert.equal(consentEvents.auditEvents[0].actorDetails.id, staffIds[0]);
    const consentDetail = await (await get(`/${consentEvents.auditEvents[0].id}`)).json();
    assert.deepEqual(consentDetail.event.metadata, { consentRecorded: true });
    assert.ok(!JSON.stringify(consentDetail).includes(canary));
    // Per-event metadata is constrained, including trusted integration identity.
    assert.deepEqual(approvedAuditMetadata("ATTENDANCE_RECORDED", { sessionId: studentId, serviceId: "development-fake-fingerprint-capture", developmentOnly: true, deviceSecret: canary, score: 1 }), { sessionId: studentId, serviceId: "development-fake-fingerprint-capture", developmentOnly: true });
    assert.deepEqual(approvedAuditMetadata("BIOMETRIC_COMPLETED", { modality: "face", operation: "ENROLL", completingDeviceId: canary, completingServiceId: canary, template: canary }), { modality: "face", operation: "ENROLL" });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await prisma.auditEntry.deleteMany({ where: { actorId: { in: staffIds } } });
    if (studentId) { await prisma.studentConsent.deleteMany({ where: { studentId } }); await prisma.student.delete({ where: { id: studentId } }); }
    if (deviceId) await prisma.developmentCheckInDevice.delete({ where: { id: deviceId } });
    await prisma.terminal.deleteMany({ where: { id: terminalId } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await prisma.$disconnect();
  }
});
