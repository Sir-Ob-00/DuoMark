import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { authConfig } from "../src/config/auth.js";
import { digest } from "../src/services/auth.service.js";
import { addRosterStudent, removeRosterStudent } from "../src/services/roster.service.js";
import { updateSection } from "../src/services/class-section.service.js";

test("roster writes, concurrent duplicates, minimal scoped My Classes and audit rollback", async () => {
  const unique = randomUUID();
  const staffIds: string[] = [];
  const studentIds: string[] = [];
  const sectionIds: string[] = [];
  const cookies: string[] = [];
  let courseId: number | undefined;
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const request = (path: string, method = "GET", cookie = cookies[0], body?: unknown) => fetch(base + path, {
    method, headers: { Origin: authConfig.origins[0], "X-CSRF-Protection": "1", Cookie: cookie, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const rosterPath = (section = sectionIds[0], student = studentIds[0]) => `/class-sections/${section}/roster/${student}`;
  try {
    for (let i = 0; i < 3; i++) {
      const staff = await prisma.staff.create({ data: { email: `roster-${i}-${unique}@example.test`, name: `Roster staff ${i}`, role: i === 0 ? "ADMIN" : "LECTURER" } });
      staffIds.push(staff.id);
      const token = randomBytes(32).toString("base64url");
      cookies.push(`${authConfig.cookieName}=${token}`);
      await prisma.staffSession.create({ data: { staffId: staff.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 60000) } });
    }
    const course = await prisma.course.create({ data: { code: `ROSTER-${unique}`.toUpperCase(), title: "Roster Course", department: "Computing" } });
    courseId = course.id;
    for (let i = 0; i < 2; i++) {
      const section = await prisma.classSection.create({ data: { code: `SECTION ${i}`, courseId, lecturerId: staffIds[i + 1], room: `Room ${i}`, schedule: "Mon 09:00", academicYear: "2026/2027", term: "SEMESTER 1" } });
      sectionIds.push(section.id);
      const student = await prisma.student.create({ data: { studentId: `ROSTER-${i}-${unique}`.toUpperCase(), name: `Student ${i}`, program: "Computing", department: "Science", level: "300", classSectionId: "legacy-unverified", faceEnrollment: "Enrolled" } });
      studentIds.push(student.id);
    }
    await prisma.studentConsent.create({ data: { studentId: studentIds[0], verifiedById: staffIds[0], consentReference: "private-consent-reference" } });
    const studentBefore = await prisma.student.findUniqueOrThrow({ where: { id: studentIds[0] } });
    for (const method of ["PUT", "DELETE"]) {
      assert.equal((await request(rosterPath(), method, cookies[1])).status, 403);
      assert.equal((await request(rosterPath(), method, cookies[2])).status, 403);
      assert.equal((await request(rosterPath(), method, "")).status, 401);
      assert.equal((await request(rosterPath(randomUUID()), method)).status, 404);
      assert.equal((await request(rosterPath(sectionIds[0], randomUUID()), method)).status, 404);
      assert.equal((await request(rosterPath("bad"), method)).status, 400);
      assert.equal((await request(rosterPath(sectionIds[0], "bad"), method)).status, 400);
      assert.equal((await request(rosterPath(), method, cookies[0], { actorId: staffIds[1] })).status, 400);
    }
    assert.equal((await request(rosterPath(), "DELETE")).status, 404);
    const simultaneous = await Promise.all([request(rosterPath(), "PUT"), request(rosterPath(), "PUT")]);
    assert.deepEqual(simultaneous.map(response => response.status).sort(), [201, 409]);
    const success = simultaneous.find(response => response.status === 201)!;
    const membership = (await success.json()).membership;
    assert.equal(membership.sectionId, sectionIds[0]);
    assert.equal(membership.studentId, studentIds[0]);
    assert.ok(Number.isFinite(Date.parse(membership.addedAt)));
    assert.equal(success.headers.get("location"), base.replace(/^https?:\/\/[^/]+/, "") + rosterPath());
    assert.equal((await request(rosterPath(), "PUT")).status, 409);
    assert.equal(await prisma.sectionRosterMembership.count({ where: { sectionId: sectionIds[0], studentId: studentIds[0] } }), 1);
    const addAudit = await prisma.auditEntry.findFirstOrThrow({ where: { sectionId: sectionIds[0], action: "ROSTER_STUDENT_ADDED" } });
    assert.equal(addAudit.actorId, staffIds[0]);
    assert.deepEqual(addAudit.details, { studentId: studentIds[0] });
    assert.equal(await prisma.auditEntry.count({ where: { sectionId: sectionIds[0], action: "ROSTER_STUDENT_ADDED" } }), 1);
    await assert.rejects(prisma.sectionRosterMembership.create({ data: { sectionId: sectionIds[0], studentId: studentIds[0] } }));
    assert.equal((await request(rosterPath(sectionIds[1], studentIds[1]), "PUT")).status, 201);
    const expectedStudent = { id: studentBefore.id, studentId: studentBefore.studentId, name: studentBefore.name };
    const sectionDetail = await request(`/class-sections/${sectionIds[0]}`, "GET", cookies[1]);
    assert.equal(sectionDetail.status, 200);
    const detail = (await sectionDetail.json()).classSection;
    assert.deepEqual(detail.roster, [expectedStudent]);
    assert.deepEqual(detail.studentIds, [studentIds[0]]);
    assert.equal((await request(`/class-sections/${sectionIds[0]}`, "GET", cookies[2])).status, 404);
    assert.equal((await request("/lecturer/classes", "GET", cookies[0])).status, 403);
    assert.equal((await request("/lecturer/classes", "GET", "")).status, 401);
    for (let i = 1; i <= 2; i++) {
      const response = await request("/lecturer/classes?page=1&limit=1", "GET", cookies[i]);
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.classes.length, 1);
      assert.equal(data.classes[0].id, sectionIds[i - 1]);
      assert.equal(data.classes[0].lecturerId, staffIds[i]);
      assert.equal(data.classes[0].course.id, courseId);
      assert.equal(data.classes[0].courseName, "Roster Course");
      assert.equal(data.classes[0].students[0].id, studentIds[i - 1]);
      assert.deepEqual(Object.keys(data.classes[0].students[0]).sort(), ["id", "name", "studentId"]);
      assert.deepEqual(data.classes[0].recentSessions, []);
      assert.equal(JSON.stringify(data).includes(studentIds[i === 1 ? 1 : 0]), false);
      assert.deepEqual(data.pagination, { page: 1, limit: 1, total: 1, totalPages: 1 });
    }
    for (const query of [`lecturerId=${staffIds[2]}`, `sectionId=${sectionIds[1]}`, "limit=101", "page=0", "page=1&page=2"]) {
      assert.equal((await request(`/lecturer/classes?${query}`, "GET", cookies[1])).status, 400);
    }
    const missingActor = randomUUID();
    await assert.rejects(addRosterStudent(sectionIds[0], studentIds[1], missingActor));
    assert.equal(await prisma.sectionRosterMembership.count({ where: { sectionId: sectionIds[0], studentId: studentIds[1] } }), 0);
    await assert.rejects(removeRosterStudent(sectionIds[0], studentIds[0], missingActor));
    assert.equal(await prisma.sectionRosterMembership.count({ where: { sectionId: sectionIds[0], studentId: studentIds[0] } }), 1);
    const removed = await request(rosterPath(), "DELETE");
    assert.equal(removed.status, 204);
    assert.equal(await removed.text(), "");
    assert.equal((await request(rosterPath(), "DELETE")).status, 404);
    assert.deepEqual(await prisma.student.findUniqueOrThrow({ where: { id: studentIds[0] } }), studentBefore);
    assert.equal(await prisma.studentConsent.count({ where: { studentId: studentIds[0] } }), 1);
    assert.equal(await prisma.sectionRosterMembership.count({ where: { sectionId: sectionIds[1] } }), 1);
    const removeAudit = await prisma.auditEntry.findFirstOrThrow({ where: { sectionId: sectionIds[0], action: "ROSTER_STUDENT_REMOVED" } });
    assert.equal(removeAudit.actorId, staffIds[0]);
    assert.deepEqual(removeAudit.details, { studentId: studentIds[0] });
    assert.equal(await prisma.auditEntry.count({ where: { sectionId: sectionIds[0] } }), 2);
    const emptyDetail = (await (await request(`/class-sections/${sectionIds[0]}`)).json()).classSection;
    assert.deepEqual(emptyDetail.roster, []);
    assert.deepEqual(emptyDetail.studentIds, []);
    assert.equal((await request(rosterPath(), "PUT")).status, 201); // re-add is a new successful membership
    await updateSection(sectionIds[0], { lecturerId: staffIds[2] }, staffIds[0]);
    assert.equal((await (await request("/lecturer/classes", "GET", cookies[1])).json()).pagination.total, 0);
    const reassigned = await (await request("/lecturer/classes", "GET", cookies[2])).json();
    assert.equal(reassigned.pagination.total, 2);
    assert.equal(reassigned.classes.find((row: { id: string }) => row.id === sectionIds[0]).students[0].id, studentIds[0]);
    assert.equal((await request(`/class-sections/${sectionIds[0]}`, "GET", cookies[1])).status, 404);
    assert.equal((await request(rosterPath(sectionIds[1], studentIds[0]), "PUT")).status, 201);
    assert.equal(await prisma.sectionRosterMembership.count({ where: { studentId: studentIds[0] } }), 2);
    assert.equal((await request(rosterPath(), "DELETE")).status, 204);
    assert.equal(await prisma.sectionRosterMembership.count({ where: { sectionId: sectionIds[1], studentId: studentIds[0] } }), 1);
    const preflight = await fetch(base + rosterPath(), { method: "OPTIONS", headers: { Origin: authConfig.origins[0], "Access-Control-Request-Method": "PUT" } });
    assert.ok(preflight.headers.get("access-control-allow-methods")?.includes("PUT"));
    assert.equal((await fetch(base.replace("/api/v1", "/health"))).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await prisma.sectionRosterMembership.deleteMany({ where: { sectionId: { in: sectionIds } } });
    await prisma.auditEntry.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.studentConsent.deleteMany({ where: { studentId: { in: studentIds } } });
    await prisma.classSection.deleteMany({ where: { id: { in: sectionIds } } });
    await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
    if (courseId) await prisma.course.delete({ where: { id: courseId } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await prisma.$disconnect();
  }
});
