import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { authConfig } from "../src/config/auth.js";
import { digest } from "../src/services/auth.service.js";
import { createCourse, updateCourse } from "../src/services/course.service.js";
import { createSection, updateSection } from "../src/services/class-section.service.js";
import { setLecturerStatus } from "../src/services/lecturer.service.js";

test("catalog preservation, section scoping, reference validation, assignments and audit atomicity", async () => {
  const unique = randomUUID();
  const staffIds: string[] = [];
  const courseIds: number[] = [];
  const sectionIds: string[] = [];
  const cookies: string[] = [];
  const originalCourses = await prisma.course.findMany({ orderBy: { id: "asc" } });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const request = (path: string, method = "GET", body?: unknown, cookie = cookies[0]) => fetch(base + "/api/v1" + path, {
    method, headers: { Origin: authConfig.origins[0], "X-CSRF-Protection": "1", Cookie: cookie, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    for (let i = 0; i < 4; i++) {
      const staff = await prisma.staff.create({ data: { email: `academic-${i}-${unique}@example.test`, name: "Academic fixture", role: i === 0 ? "ADMIN" : "LECTURER", status: i === 3 ? "Inactive" : "Active" } });
      staffIds.push(staff.id);
      const token = randomBytes(32).toString("base64url");
      cookies.push(`${authConfig.cookieName}=${token}`);
      await prisma.staffSession.create({ data: { staffId: staff.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 60000) } });
    }
    for (const path of ["/courses", "/class-sections"]) assert.equal((await request(path, "GET", undefined, "")).status, 401);
    const code = `TEST-${unique}`.toUpperCase();
    const courseInput = { code: code.toLowerCase(), name: "Intro to Computing", department: "Computing" };
    const created = await request("/courses", "POST", courseInput);
    assert.equal(created.status, 201);
    const course = (await created.json()).course;
    courseIds.push(course.id);
    assert.deepEqual(course, { id: course.id, code, name: courseInput.name, department: courseInput.department });
    assert.equal(typeof course.id, "number");
    assert.equal((await prisma.course.findUniqueOrThrow({ where: { id: course.id } })).title, courseInput.name);
    assert.equal((await request("/courses", "POST", { ...courseInput, code: ` ${code} ` })).status, 409);
    await assert.rejects(prisma.course.create({ data: { code: code.toLowerCase(), title: "Direct duplicate" } }));
    const second = await request("/courses", "POST", { ...courseInput, code: `${code}-2` });
    assert.equal(second.status, 201);
    const course2 = (await second.json()).course;
    courseIds.push(course2.id);
    assert.equal((await request(`/courses/${course2.id}`, "PATCH", { code: code.toLowerCase() })).status, 409);
    assert.equal((await request(`/courses/${course.id}`, "PATCH", { title: "Wrong API field" })).status, 400);
    assert.equal((await request(`/courses/${course.id}`, "PATCH", { name: "Updated course" })).status, 200);
    assert.equal((await request("/courses/bad", "PATCH", { name: "Bad" })).status, 400);
    assert.equal((await request("/courses/2147483647", "PATCH", { name: "Missing" })).status, 404);
    const allCourses = await (await request("/courses")).json();
    assert.equal(allCourses.pagination.total, originalCourses.length + 2);
    assert.equal((await (await request("/courses", "GET", undefined, cookies[1])).json()).courses.length, 0);
    const sectionInput = { code: "section a", courseId: String(course.id), lecturerId: staffIds[1], room: "Lab 1", schedule: "Mon 09:00", academicYear: "2026/2027", term: "semester 1" };
    for (const bad of [{ ...sectionInput, courseId: 2147483647 }, { ...sectionInput, lecturerId: randomUUID() }, { ...sectionInput, lecturerId: staffIds[0] }, { ...sectionInput, lecturerId: staffIds[3] }, { ...sectionInput, academicYear: "2026/2028" }, { ...sectionInput, studentIds: [] }]) {
      assert.equal((await request("/class-sections", "POST", bad)).status, 400);
    }
    for (const [path, method, body] of [["/courses", "POST", courseInput], [`/courses/${course.id}`, "PATCH", { name: "Not allowed" }], ["/class-sections", "POST", sectionInput], [`/class-sections/${randomUUID()}`, "PATCH", { room: "Not allowed" }]] as const) {
      assert.equal((await request(path, method, body, cookies[1])).status, 403);
    }
    const sectionResponse = await request("/class-sections", "POST", sectionInput);
    assert.equal(sectionResponse.status, 201);
    const section = (await sectionResponse.json()).classSection;
    sectionIds.push(section.id);
    assert.equal(section.code, "SECTION A");
    assert.equal(section.term, "SEMESTER 1");
    assert.equal(section.course.id, course.id);
    assert.equal(section.lecturer.id, staffIds[1]);
    assert.equal(section.lecturer.passwordHash, undefined);
    assert.deepEqual(section.studentIds, []);
    assert.equal((await request("/class-sections", "POST", { ...sectionInput, code: "SECTION A" })).status, 409);
    const nextPeriod = await request("/class-sections", "POST", { ...sectionInput, academicYear: "2027/2028", lecturerId: staffIds[2] });
    assert.equal(nextPeriod.status, 201);
    const periodSection = (await nextPeriod.json()).classSection;
    sectionIds.push(periodSection.id);
    const nextTerm = await request("/class-sections", "POST", { ...sectionInput, term: "semester 2", courseId: course2.id, lecturerId: staffIds[2] });
    assert.equal(nextTerm.status, 201);
    const termSection = (await nextTerm.json()).classSection;
    sectionIds.push(termSection.id);
    assert.equal((await request(`/class-sections/${periodSection.id}`, "PATCH", { academicYear: "2026/2027" })).status, 409);
    const detail = await request(`/class-sections/${section.id}`, "GET", undefined, cookies[1]);
    assert.equal(detail.status, 200);
    assert.deepEqual((await detail.json()).classSection.roster, []);
    assert.equal((await request(`/class-sections/${section.id}`, "GET", undefined, cookies[2])).status, 404);
    assert.equal((await request(`/class-sections/${randomUUID()}`)).status, 404);
    assert.equal((await request("/class-sections/bad")).status, 400);
    const list = await (await request(`/class-sections?courseId=${course.id}&lecturerId=${staffIds[1]}`)).json();
    assert.equal(list.pagination.total, 1);
    assert.equal(list.classSections[0].id, section.id);
    const ownList = await (await request("/class-sections", "GET", undefined, cookies[1])).json();
    assert.equal(ownList.pagination.total, 1);
    for (const filters of [`lecturerId=${staffIds[2]}`, `courseId=${course2.id}`, `courseId=${course.id}&lecturerId=${staffIds[2]}`]) {
      assert.equal((await (await request(`/class-sections?${filters}`, "GET", undefined, cookies[1])).json()).pagination.total, 0);
    }
    const ownCourses = await (await request("/courses", "GET", undefined, cookies[1])).json();
    assert.deepEqual(ownCourses.courses.map((row: { id: number }) => row.id), [course.id]);
    const assigned = await (await request(`/admin/lecturers/${staffIds[1]}`)).json();
    assert.deepEqual(assigned.lecturer.assignedClasses.map((row: { id: string }) => row.id), [section.id]);
    for (const bad of [{ lecturerId: staffIds[3] }, { lecturerId: staffIds[0] }, { courseId: 2147483647 }, { studentIds: [] }, { id: randomUUID() }, {}]) {
      assert.equal((await request(`/class-sections/${section.id}`, "PATCH", bad)).status, 400);
    }
    assert.equal((await request(`/class-sections/${section.id}`, "PATCH", { lecturerId: staffIds[2], room: "Lab 2" })).status, 200);
    assert.equal((await request(`/class-sections/${section.id}`, "GET", undefined, cookies[1])).status, 404);
    assert.equal((await request(`/class-sections/${section.id}`, "GET", undefined, cookies[2])).status, 200);
    assert.equal((await (await request("/courses", "GET", undefined, cookies[1])).json()).pagination.total, 0);
    assert.equal((await (await request("/courses", "GET", undefined, cookies[2])).json()).pagination.total, 2); // deduplicated despite two sections in one course
    assert.equal((await (await request("/class-sections", "GET", undefined, cookies[1])).json()).pagination.total, 0);
    assert.equal((await (await request(`/admin/lecturers/${staffIds[1]}`)).json()).lecturer.assignedClasses.length, 0);
    assert.equal((await (await request(`/admin/lecturers/${staffIds[2]}`)).json()).lecturer.assignedClasses.length, 3);
    const reassignmentAudit = await prisma.auditEntry.findFirstOrThrow({ where: { sectionId: section.id, action: "CLASS_SECTION_UPDATED" } });
    assert.equal(reassignmentAudit.actorId, staffIds[0]);
    assert.equal((reassignmentAudit.details as { before: { lecturerId: string } }).before.lecturerId, staffIds[1]);
    await setLecturerStatus(staffIds[2], "Inactive", staffIds[0]);
    assert.equal((await (await request(`/admin/lecturers/${staffIds[2]}`)).json()).lecturer.assignedClasses.length, 3);
    assert.equal((await request(`/class-sections/${section.id}`, "PATCH", { room: "Lab 3" })).status, 200);
    assert.equal((await request(`/class-sections/${section.id}`, "PATCH", { lecturerId: staffIds[2] })).status, 400);
    for (const path of ["/courses?limit=101", "/courses?lecturerId=ignored", "/class-sections?courseId=bad", "/class-sections?lecturerId=bad", "/class-sections?courseId=1&courseId=2", "/class-sections?term[x]=y"]) assert.equal((await request(path)).status, 400);
    const missingActor = randomUUID();
    await assert.rejects(createCourse({ code: `${code}-ROLLBACK`, name: "Rollback", department: "Computing" }, missingActor));
    assert.equal(await prisma.course.count({ where: { code: `${code}-ROLLBACK` } }), 0);
    await assert.rejects(updateCourse(course.id, { name: "Rollback" }, missingActor));
    assert.equal((await prisma.course.findUniqueOrThrow({ where: { id: course.id } })).title, "Updated course");
    await assert.rejects(createSection({ ...sectionInput, code: "ROLLBACK", term: "SEMESTER 1", courseId: course.id }, missingActor));
    assert.equal(await prisma.classSection.count({ where: { code: "ROLLBACK", courseId: course.id } }), 0);
    await assert.rejects(updateSection(section.id, { room: "Rollback" }, missingActor));
    assert.equal((await prisma.classSection.findUniqueOrThrow({ where: { id: section.id } })).room, "Lab 3");
    assert.equal((await fetch(base + "/health")).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await prisma.auditEntry.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.classSection.deleteMany({ where: { id: { in: sectionIds } } });
    await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    assert.deepEqual(await prisma.course.findMany({ orderBy: { id: "asc" } }), originalCourses);
    await prisma.$disconnect();
  }
});
