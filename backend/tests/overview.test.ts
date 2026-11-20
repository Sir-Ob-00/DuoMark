import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { digest } from "../src/services/auth.service.js";
import { authConfig } from "../src/config/auth.js";
import { adminOverview, lecturerOverview } from "../src/services/overview.service.js";

test("overview aggregates: database totals, UTC boundaries, pagination and lecturer isolation", async () => {
  const unique = randomUUID();
  const staffIds: string[] = [], cookies: string[] = [], sectionIds: string[] = [], studentIds: string[] = [], sessionIds: string[] = [];
  const terminalIds = [`o-${unique}`, `p-${unique}`];
  let courseId: number | undefined, deviceId: string | undefined;
  const now = new Date(), today = now.toISOString().slice(0, 10);
  const start = new Date(`${today}T00:00:00.000Z`), end = new Date(start.getTime() + 86400000);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const overview = (role: "admin" | "lecturer", cookie = role === "admin" ? cookies[0] : cookies[1], query = "") => fetch(`${base}/${role}/overview${query}`, { headers: cookie ? { Cookie: cookie } : {} });
  try {
    for (let i = 0; i < 3; i++) {
      staffIds.push((await prisma.staff.create({ data: { name: `Overview ${i}`, email: `overview-${i}-${unique}@example.test`, role: i ? "LECTURER" : "ADMIN" } })).id);
      const token = randomBytes(32).toString("base64url"); cookies.push(`${authConfig.cookieName}=${token}`);
      await prisma.staffSession.create({ data: { staffId: staffIds[i], tokenHash: digest(token), expiresAt: new Date(Date.now() + 60000) } });
    }
    courseId = (await prisma.course.create({ data: { code: `OVERVIEW-${unique}`.toUpperCase(), title: "Overview fixture" } })).id;
    for (let i = 0; i < 3; i++) sectionIds.push((await prisma.classSection.create({ data: { code: `SECTION ${i}`, courseId, lecturerId: staffIds[i === 0 ? 1 : 2], room: "Test", schedule: "Test", academicYear: "2026/2027", term: "TEST", isFictional: true } })).id);
    for (let i = 0; i < 2; i++) await prisma.terminal.create({ data: { id: terminalIds[i], name: `Overview station ${i}`, location: "Test", status: i ? "Unavailable" : "Available", isFictional: true } });
    deviceId = (await prisma.developmentCheckInDevice.create({ data: { terminalId: terminalIds[0], credentialHash: digest(randomBytes(32).toString("base64url")) } })).id;
    for (let i = 0; i < 25; i++) studentIds.push((await prisma.student.create({ data: { studentId: `OVERVIEW-${i}-${unique}`.toUpperCase(), name: `Overview student ${i}`, program: "Test", department: "Test", level: "100", classSectionId: sectionIds[0], faceEnrollment: i % 2 ? "Pending" : "Enrolled", fingerprintEnrollment: i % 3 ? "Pending" : "Enrolled", isFictional: true } })).id);
    // Own open/current, own closed/former, other's closed/our current class,
    // other's open/other class. History scope is always the original opener.
    for (const [section, lecturer, open, terminal] of [[0, 1, true, 0], [2, 1, false, 0], [0, 2, false, 1], [1, 2, true, 1]] as const) sessionIds.push((await prisma.attendanceSession.create({ data: { sectionId: sectionIds[section], lecturerId: staffIds[lecturer], terminalId: terminalIds[terminal], courseId, courseCode: "TEST", courseName: "Overview fixture", sectionCode: `SECTION ${section}`, room: "Test", academicYear: "2026/2027", term: "TEST", openedAt: new Date(start.getTime() - 86400000), status: open ? "OPEN" : "CLOSED", closedAt: open ? null : start } })).id);
    const addRecord = (session: number, student: number, recordedAt: Date) => prisma.attendanceRecord.create({ data: { sessionId: sessionIds[session], studentId: studentIds[student], studentIndexNumber: `TEST-${student}`, studentName: `Fixture ${student}`, deviceId: deviceId!, terminalId: terminalIds[session >= 2 ? 1 : 0], recordedAt } });
    for (const [index, time] of [start.getTime() - 1, start.getTime(), end.getTime() - 1, end.getTime()].entries()) await addRecord(0, index, new Date(time));
    for (let i = 1; i < 4; i++) await addRecord(i, 0, start);
    const response = await overview("lecturer"); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    const own = await response.json();
    assert.deepEqual(own, { counts: { assignedClasses: 1, openSessions: 1, totalSessions: 2, attendanceRecords: 5, checkInsToday: 3 }, context: { academicTimeZone: "UTC", today } });
    const [classes, sessions, records] = await Promise.all([
      fetch(`${base}/lecturer/classes?limit=1`, { headers: { Cookie: cookies[1] } }).then(r => r.json()),
      fetch(`${base}/lecturer/sessions?limit=1`, { headers: { Cookie: cookies[1] } }).then(r => r.json()),
      fetch(`${base}/attendance-records?limit=1`, { headers: { Cookie: cookies[1] } }).then(r => r.json()),
    ]);
    assert.equal(own.counts.assignedClasses, classes.pagination.total);
    assert.equal(own.counts.totalSessions, sessions.pagination.total);
    assert.equal(own.counts.attendanceRecords, records.pagination.total);
    assert.equal(records.attendanceRecords.length, 1); // aggregate isn't the visible page length
    const scopedRecordCount = await prisma.attendanceRecord.count({ where: { session: { lecturerId: staffIds[1] } } });
    assert.equal(own.counts.attendanceRecords, scopedRecordCount);
    const beforeOtherActivity = await lecturerOverview(staffIds[1], now);
    await addRecord(2, 4, start); // another lecturer checking into our current class
    const extra = await prisma.attendanceSession.create({ data: { sectionId: sectionIds[1], lecturerId: staffIds[2], terminalId: terminalIds[1], courseId, courseCode: "TEST", courseName: "Other activity", sectionCode: "SECTION 1", room: "Test", academicYear: "2026/2027", term: "TEST", openedAt: start, closedAt: start, status: "CLOSED" } }); sessionIds.push(extra.id);
    assert.deepEqual(await lecturerOverview(staffIds[1], now), beforeOtherActivity);
    assert.deepEqual(await (await overview("lecturer")).json(), own);
    await prisma.sectionRosterMembership.create({ data: { sectionId: sectionIds[0], studentId: studentIds[0] } });
    await prisma.sectionRosterMembership.delete({ where: { sectionId_studentId: { sectionId: sectionIds[0], studentId: studentIds[0] } } });
    assert.deepEqual(await lecturerOverview(staffIds[1], now), beforeOtherActivity); // historical attendance remains official
    await prisma.classSection.update({ where: { id: sectionIds[0] }, data: { lecturerId: staffIds[2] } });
    assert.deepEqual((await lecturerOverview(staffIds[1], now)).counts, { ...own.counts, assignedClasses: 0 });
    const adminResponse = await overview("admin"); assert.equal(adminResponse.status, 200);
    const admin = await adminResponse.json();
    assert.deepEqual(admin, await adminOverview(now));
    assert.deepEqual(admin.counts, {
      lecturers: await prisma.staff.count({ where: { role: "LECTURER" } }),
      studentProfiles: await prisma.student.count(), faceEnrolledStudents: await prisma.student.count({ where: { faceEnrollment: "Enrolled" } }), fingerprintEnrolledStudents: await prisma.student.count({ where: { fingerprintEnrollment: "Enrolled" } }),
      openSessions: await prisma.attendanceSession.count({ where: { status: "OPEN" } }), totalSessions: await prisma.attendanceSession.count(), availableTerminals: await prisma.terminal.count({ where: { status: "Available" } }), totalTerminals: await prisma.terminal.count(), attendanceRecords: await prisma.attendanceRecord.count(), checkInsToday: await prisma.attendanceRecord.count({ where: { recordedAt: { gte: start, lt: end } } }),
    });
    assert.ok(admin.counts.studentProfiles >= 25);
    assert.ok(admin.counts.faceEnrolledStudents >= 13);
    assert.ok(admin.counts.fingerprintEnrolledStudents >= 9);
    assert.equal(adminResponse.headers.get("cache-control"), "no-store");
    assert.equal((await overview("admin", cookies[1])).status, 403); assert.equal((await overview("lecturer", cookies[0])).status, 403);
    for (const role of ["admin", "lecturer"] as const) {
      assert.equal((await overview(role, "")).status, 401);
      assert.equal((await fetch(`${base}/${role}/overview`, { headers: { Authorization: `Bearer ${randomBytes(32).toString("base64url")}` } })).status, 401);
      assert.equal((await overview(role, role === "admin" ? cookies[0] : cookies[1], "?limit=1")).status, 400);
      assert.equal((await overview(role, role === "admin" ? cookies[0] : cookies[1], `?lecturerId=${staffIds[2]}`)).status, 400);
    }
    assert.equal((await fetch(base.replace("/api/v1", "/health"))).status, 200);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (deviceId) { await prisma.attendanceRecord.deleteMany({ where: { deviceId } }); await prisma.developmentCheckInDevice.delete({ where: { id: deviceId } }); }
    await prisma.attendanceSession.deleteMany({ where: { id: { in: sessionIds } } });
    await prisma.sectionRosterMembership.deleteMany({ where: { sectionId: { in: sectionIds } } });
    await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
    await prisma.classSection.deleteMany({ where: { id: { in: sectionIds } } });
    await prisma.terminal.deleteMany({ where: { id: { in: terminalIds } } });
    if (courseId) await prisma.course.delete({ where: { id: courseId } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } }); await prisma.$disconnect();
  }
});
