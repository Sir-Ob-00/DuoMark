import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { authConfig } from "../src/config/auth.js";
import { digest } from "../src/services/auth.service.js";

test("public terminal display: waiting/ready/waiting, station isolation and exact public fields", async () => {
  const unique = randomUUID();
  const staffIds: string[] = [];
  const cookies: string[] = [];
  const terminalIds = [`p-${unique}`, `q-${unique}`];
  let courseId: number | undefined;
  let sectionId: string | undefined;
  let studentId: string | undefined;
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  // Public polling deliberately sends NO cookies, authorization or staff headers.
  const poll = (id: string) => fetch(`${base}/terminals/${id}/session`);
  const mutate = (path: string, method: string, cookie: string, body?: unknown) => fetch(base + path, {
    method, headers: { Cookie: cookie, Origin: authConfig.origins[0], "X-CSRF-Protection": "1", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    for (const role of ["ADMIN", "LECTURER"] as const) {
      const staff = await prisma.staff.create({ data: { email: `${role}-public-${unique}@example.test`, name: "Private staff identity", role } });
      staffIds.push(staff.id);
      const token = randomBytes(32).toString("base64url");
      cookies.push(`${authConfig.cookieName}=${token}`);
      await prisma.staffSession.create({ data: { staffId: staff.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 60000) } });
    }
    const course = await prisma.course.create({ data: { code: `PUBLIC-${unique}`.toUpperCase(), title: "Public Course Title" } });
    courseId = course.id;
    const section = await prisma.classSection.create({ data: { code: "SECTION A", courseId, lecturerId: staffIds[1], room: "Private teaching metadata", schedule: "Mon", academicYear: "2026/2027", term: "SEMESTER 1" } });
    sectionId = section.id;
    const student = await prisma.student.create({ data: { studentId: `PRIVATE-${unique}`.toUpperCase(), name: "Private roster identity", program: "Computing", department: "Computing", level: "300", classSectionId: sectionId, faceEnrollment: "Enrolled" } });
    studentId = student.id;
    await prisma.sectionRosterMembership.create({ data: { sectionId, studentId } });
    await prisma.studentConsent.create({ data: { studentId, verifiedById: staffIds[0], consentReference: "Private consent reference" } });
    for (let i = 0; i < terminalIds.length; i++) await prisma.terminal.create({ data: { id: terminalIds[i], name: `Station ${i}`, location: `Lab ${i}` } });
    const beforePoll = await prisma.auditEntry.count({ where: { actorId: { in: staffIds } } });
    for (let i = 0; i < terminalIds.length; i++) {
      const waiting = await poll(terminalIds[i]);
      assert.equal(waiting.status, 200);
      assert.equal(waiting.headers.get("cache-control"), "no-store");
      assert.equal(waiting.headers.get("set-cookie"), null);
      assert.deepEqual(await waiting.json(), { terminal: { id: terminalIds[i], name: `Station ${i}`, location: `Lab ${i}` }, activeSession: null });
    }
    assert.equal(await prisma.auditEntry.count({ where: { actorId: { in: staffIds } } }), beforePoll);
    const opened = await mutate("/lecturer/sessions", "POST", cookies[1], { sectionId, terminalId: terminalIds[0] });
    assert.equal(opened.status, 201);
    const session = (await opened.json()).session;
    const ready = await poll(terminalIds[0]);
    assert.equal(ready.status, 200);
    assert.equal(ready.headers.get("cache-control"), "no-store");
    const expected = { terminal: { id: terminalIds[0], name: "Station 0", location: "Lab 0" },
      activeSession: { id: session.id, sectionCode: "SECTION A", courseCode: course.code, courseName: course.title } };
    assert.deepEqual(await ready.json(), expected); // exact allowlist at every level
    assert.equal((await (await poll(terminalIds[1])).json()).activeSession, null);
    const unavailable = await mutate(`/admin/terminals/${terminalIds[0]}/availability`, "PATCH", cookies[0], { status: "Unavailable" });
    assert.equal(unavailable.status, 200);
    assert.deepEqual(await (await poll(terminalIds[0])).json(), expected);
    assert.equal((await (await poll(terminalIds[1])).json()).activeSession, null);
    const closed = await mutate(`/lecturer/sessions/${session.id}/close`, "POST", cookies[1]);
    assert.equal(closed.status, 200);
    const waitingAgain = await poll(terminalIds[0]);
    assert.equal(waitingAgain.status, 200);
    assert.equal(waitingAgain.headers.get("cache-control"), "no-store");
    assert.deepEqual(await waitingAgain.json(), { terminal: expected.terminal, activeSession: null });
    const secondOpen = await mutate("/lecturer/sessions", "POST", cookies[1], { sectionId, terminalId: terminalIds[1] });
    assert.equal(secondOpen.status, 201);
    const secondSession = (await secondOpen.json()).session;
    assert.equal((await (await poll(terminalIds[0])).json()).activeSession, null);
    assert.equal((await (await poll(terminalIds[1])).json()).activeSession.id, secondSession.id);
    const missing = await poll("missing-station");
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get("cache-control"), "no-store");
    assert.deepEqual(await missing.json(), { error: "Terminal not found" });
    assert.equal((await poll("INVALID-ID")).status, 400);
    assert.equal((await fetch(`${base}/terminals/${terminalIds[0]}/session?sessionId=${secondSession.id}`)).status, 400);
    // A public station/session identifier grants no staff permission.
    assert.equal((await fetch(`${base}/admin/terminals/${terminalIds[0]}`, { headers: { "X-Terminal-ID": terminalIds[0] } })).status, 401);
    assert.equal((await fetch(`${base}/lecturer/sessions/${secondSession.id}`, { headers: { "X-Terminal-ID": terminalIds[1] } })).status, 401);
    const auditCount = await prisma.auditEntry.count({ where: { actorId: { in: staffIds } } });
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const rejected = await mutate(`/terminals/${terminalIds[0]}/session`, method, "");
      assert.equal(rejected.status, 404);
    }
    assert.equal(await prisma.auditEntry.count({ where: { actorId: { in: staffIds } } }), auditCount);
    assert.equal((await prisma.attendanceSession.findUniqueOrThrow({ where: { id: secondSession.id } })).status, "OPEN");
    assert.equal((await fetch(base.replace("/api/v1", "/health"))).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await prisma.auditEntry.deleteMany({ where: { actorId: { in: staffIds } } });
    if (sectionId) {
      await prisma.attendanceSession.deleteMany({ where: { sectionId } });
      await prisma.sectionRosterMembership.deleteMany({ where: { sectionId } });
    }
    if (studentId) { await prisma.studentConsent.deleteMany({ where: { studentId } }); await prisma.student.delete({ where: { id: studentId } }); }
    if (sectionId) await prisma.classSection.delete({ where: { id: sectionId } });
    await prisma.terminal.deleteMany({ where: { id: { in: terminalIds } } });
    if (courseId) await prisma.course.delete({ where: { id: courseId } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await prisma.$disconnect();
  }
});
