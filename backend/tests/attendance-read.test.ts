import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { authConfig } from "../src/config/auth.js";
import { digest } from "../src/services/auth.service.js";
import { closeSession } from "../src/services/attendance-session.service.js";
import { updateSection } from "../src/services/class-section.service.js";
import { removeRosterStudent } from "../src/services/roster.service.js";

test("official attendance reads: role scope, combined record-date filters and durable historical register", async () => {
  const unique = randomUUID();
  const staffIds: string[] = [];
  const studentIds: string[] = [];
  const courseIds: number[] = [];
  const sectionIds: string[] = [];
  const sessionIds: string[] = [];
  const cookies: string[] = [];
  const terminalId = `e-${unique}`;
  const deviceToken = randomBytes(32).toString("base64url");
  let deviceId: string | undefined;
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const request = (path: string, cookie = cookies[0], headers: Record<string, string> = {}) => fetch(base + path, { headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } });
  const registerPath = () => `/sessions/${sessionIds[0]}/attendance`;
  const root = "/attendance-records";
  const dayRecords: { id: string; recordedAt: Date }[] = [];
  try {
    for (let i = 0; i < 3; i++) {
      const staff = await prisma.staff.create({ data: { email: `attendance-read-${i}-${unique}@example.test`, name: `Staff ${i}`, role: i === 0 ? "ADMIN" : "LECTURER" } });
      staffIds.push(staff.id);
      const token = randomBytes(32).toString("base64url");
      cookies.push(`${authConfig.cookieName}=${token}`);
      await prisma.staffSession.create({ data: { staffId: staff.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 60000) } });
    }
    for (let i = 0; i < 2; i++) {
      const course = await prisma.course.create({ data: { code: `READ-${i}-${unique}`.toUpperCase(), title: `Historical Course ${i}` } });
      courseIds.push(course.id);
    }
    await prisma.terminal.create({ data: { id: terminalId, name: "Fictional report station", location: "Test", isFictional: true } });
    for (let i = 0; i < 3; i++) {
      const section = await prisma.classSection.create({ data: { code: `SECTION ${i}`, courseId: i === 2 ? courseIds[1] : courseIds[0], lecturerId: staffIds[1], room: "Test", schedule: "Test", academicYear: "2026/2027", term: "TEST", isFictional: true } });
      sectionIds.push(section.id);
    }
    for (let i = 0; i < 7; i++) {
      const student = await prisma.student.create({ data: { studentId: `CURRENT-${i}-${unique}`.toUpperCase(), name: `Current profile ${i}`, program: "Test", department: "Test", level: "100", classSectionId: sectionIds[0], isFictional: true, faceEnrollment: "Enrolled", fingerprintEnrollment: "Enrolled" } });
      studentIds.push(student.id);
      await prisma.sectionRosterMembership.create({ data: { sectionId: sectionIds[0], studentId: student.id } });
    }
    const device = await prisma.developmentCheckInDevice.create({ data: { terminalId, credentialHash: digest(deviceToken), fakeStudentId: studentIds[0] } });
    deviceId = device.id;
    const consent = await prisma.studentConsent.create({ data: { studentId: studentIds[6], verifiedById: staffIds[0], consentReference: "Private consent reference" } });
    for (const [sectionIndex, lecturerIndex, open] of [[0, 1, true], [0, 2, false], [1, 1, false], [2, 1, false]] as const) {
      const courseIndex = sectionIndex === 2 ? 1 : 0;
      const session = await prisma.attendanceSession.create({ data: { sectionId: sectionIds[sectionIndex], lecturerId: staffIds[lecturerIndex], terminalId, courseId: courseIds[courseIndex],
        courseCode: `ORIGINAL ${courseIndex}`, courseName: `Historical Course ${courseIndex}`, sectionCode: `SECTION ${sectionIndex}`, room: "Test", academicYear: "2026/2027", term: "TEST",
        openedAt: new Date("2026-03-01T00:00:00Z"), status: open ? "OPEN" : "CLOSED", closedAt: open ? null : new Date("2026-03-05T00:00:00Z") } });
      sessionIds.push(session.id);
    }
    const times = ["2026-03-01T23:59:59.999Z", "2026-03-02T00:00:00.000Z", "2026-03-02T12:00:00.000Z", "2026-03-02T23:59:59.999Z", "2026-03-03T00:00:00.000Z", "2026-03-02T12:00:00.000Z"];
    for (let i = 0; i < times.length; i++) {
      const record = await prisma.attendanceRecord.create({ data: { sessionId: sessionIds[0], studentId: studentIds[i], studentIndexNumber: `HISTORICAL-${i}`, studentName: `Recorded name ${i}`, deviceId, terminalId, recordedAt: new Date(times[i]) } });
      if ([1, 2, 3, 5].includes(i)) dayRecords.push(record);
    }
    for (let i = 1; i < sessionIds.length; i++) await prisma.attendanceRecord.create({ data: { sessionId: sessionIds[i], studentId: studentIds[1], studentIndexNumber: "HISTORICAL-1", studentName: "Recorded name 1", deviceId, terminalId, recordedAt: new Date("2026-03-02T12:00:00Z") } });
    await prisma.faceVerificationAttempt.create({ data: { tokenHash: digest(randomBytes(32).toString("base64url")), deviceId, terminalId, attendanceSessionId: sessionIds[0], studentId: studentIds[6], consentId: consent.id, serviceId: "development-fake-face-capture", challengeId: randomUUID(), status: "INVALIDATED", expiresAt: new Date(Date.now() + 120000) } });

    for (const path of [registerPath(), root]) {
      assert.equal((await request(path, "")).status, 401);
      assert.equal((await request(path, "", { Authorization: `Bearer ${deviceToken}` })).status, 401);
    }
    const admin = await request(registerPath());
    assert.equal(admin.status, 200);
    assert.equal(admin.headers.get("cache-control"), "no-store");
    const originalRegister = await admin.json();
    assert.equal(originalRegister.attendance.length, 6); // not seven roster members or failed face attempts
    assert.deepEqual(await (await request(registerPath(), cookies[1])).json(), originalRegister);
    assert.equal((await request(registerPath(), cookies[2])).status, 404);
    assert.equal((await request(`/sessions/${randomUUID()}/attendance`)).status, 404);
    assert.equal((await request("/sessions/bad/attendance")).status, 400);
    assert.equal((await request(registerPath() + "?studentId=" + studentIds[0])).status, 400);
    for (const row of originalRegister.attendance) {
      assert.deepEqual(Object.keys(row).sort(), ["developmentOnly", "id", "indexNumber", "recordedAt", "sessionId", "status", "studentId", "studentName"]);
      assert.ok(row.studentName.startsWith("Recorded name"));
    }
    assert.equal(originalRegister.attendance.some((row: { studentId: string }) => row.studentId === studentIds[6]), false);
    assert.equal((await (await request(root + `?studentId=${studentIds[6]}`)).json()).pagination.total, 0);
    const ownerReport = await (await request(root, cookies[1])).json();
    assert.equal(ownerReport.pagination.total, 8);
    assert.ok(ownerReport.attendanceRecords.every((row: { lecturerId: string }) => row.lecturerId === staffIds[1]));
    assert.equal((await (await request(root, cookies[2])).json()).pagination.total, 1);
    assert.equal((await (await request(root + `?sessionId=${sessionIds[0]}`, cookies[2])).json()).pagination.total, 0);
    const combined = `sessionId=${sessionIds[0]}&sectionId=${sectionIds[0]}&courseId=${courseIds[0]}&studentId=${studentIds[2]}&dateFrom=2026-03-02&dateTo=2026-03-02`;
    const combinedResponse = await request(root + "?" + combined, cookies[1]);
    assert.equal(combinedResponse.status, 200);
    const combinedBody = await combinedResponse.json();
    assert.equal(combinedBody.pagination.total, 1);
    assert.equal(combinedBody.attendanceRecords[0].studentId, studentIds[2]);
    assert.equal(combinedBody.attendanceRecords[0].courseCode, "ORIGINAL 0");
    assert.deepEqual(Object.keys(combinedBody.attendanceRecords[0]).sort(), ["courseCode", "courseId", "courseName", "developmentOnly", "id", "indexNumber", "lecturerId", "recordedAt", "sectionCode", "sectionId", "sessionId", "status", "studentId", "studentName"]);
    assert.equal((await (await request(root + "?" + combined, cookies[2])).json()).pagination.total, 0);
    const dayFilter = `sessionId=${sessionIds[0]}&dateFrom=2026-03-02&dateTo=2026-03-02`;
    const expected = dayRecords.sort((left, right) => right.recordedAt.getTime() - left.recordedAt.getTime() || (left.id < right.id ? 1 : left.id > right.id ? -1 : 0)).map(row => row.id);
    const firstPage = await (await request(root + `?${dayFilter}&page=1&limit=2`)).json();
    const secondPage = await (await request(root + `?${dayFilter}&page=2&limit=2`)).json();
    assert.deepEqual(firstPage.pagination, { page: 1, limit: 2, total: 4, totalPages: 2 });
    assert.deepEqual([...firstPage.attendanceRecords, ...secondPage.attendanceRecords].map(row => row.id), expected);
    assert.deepEqual((await (await request(root + `?${dayFilter}&page=3&limit=2`)).json()).attendanceRecords, []);
    // Session opened March 1: filtering March 2 must use recordedAt, not openedAt.
    assert.equal(firstPage.pagination.total, 4);
    assert.equal((await (await request(root + `?sessionId=${sessionIds[0]}&dateFrom=2026-03-03`)).json()).pagination.total, 1);
    assert.equal((await (await request(root + `?sessionId=${sessionIds[0]}&dateTo=2026-03-01`)).json()).pagination.total, 1);
    for (const query of ["sessionId=bad", "sectionId=bad", "studentId=bad", "courseId=0", "courseId=1.5", "dateFrom=2026-02-30", "dateTo=2025-02-29", "dateFrom=2026-03-03&dateTo=2026-03-02", "dateFrom=2026-03-02T00%3A00%3A00Z", "dateFrom[x]=y", "page=0", "limit=101", "courseId=1&courseId=2", `lecturerId=${staffIds[2]}`]) assert.equal((await request(root + "?" + query)).status, 400);
    assert.equal((await request(root + "?dateFrom=2024-02-29&dateTo=2024-02-29")).status, 200);
    await updateSection(sectionIds[0], { lecturerId: staffIds[2], courseId: courseIds[1] }, staffIds[0]);
    await removeRosterStudent(sectionIds[0], studentIds[2], staffIds[0]);
    await prisma.student.update({ where: { id: studentIds[2] }, data: { name: "Renamed after attendance" } });
    await closeSession(sessionIds[0], staffIds[1]);
    assert.deepEqual(await (await request(registerPath(), cookies[1])).json(), originalRegister);
    assert.equal((await request(registerPath(), cookies[2])).status, 404);
    assert.equal((await (await request(root + "?" + combined, cookies[1])).json()).pagination.total, 1); // stored course and opener survive reassignment
    const lecturerDetails = await (await request(`/lecturer/sessions/${sessionIds[0]}`, cookies[1])).json();
    const adminDetails = await (await request(`/admin/sessions/${sessionIds[0]}`)).json();
    assert.equal(lecturerDetails.session.status, "Closed");
    assert.deepEqual(lecturerDetails.session.attendance, originalRegister.attendance);
    assert.deepEqual(adminDetails.session.attendance, originalRegister.attendance);
    assert.equal(await prisma.attendanceRecord.count({ where: { sessionId: sessionIds[0] } }), 6);
    assert.equal((await request(root + `?sessionId=${sessionIds[1]}&studentId=${studentIds[1]}`, cookies[1])).status, 200);
    assert.equal((await (await request(root + `?sessionId=${sessionIds[1]}&studentId=${studentIds[1]}`, cookies[1])).json()).pagination.total, 0);
    assert.equal((await fetch(base.replace("/api/v1", "/health"))).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await prisma.auditEntry.deleteMany({ where: { actorId: { in: staffIds } } });
    if (deviceId) {
      await prisma.faceVerificationAttempt.deleteMany({ where: { deviceId } });
      await prisma.attendanceRecord.deleteMany({ where: { deviceId } });
      await prisma.developmentCheckInDevice.delete({ where: { id: deviceId } });
    }
    await prisma.attendanceSession.deleteMany({ where: { id: { in: sessionIds } } });
    await prisma.sectionRosterMembership.deleteMany({ where: { sectionId: { in: sectionIds } } });
    await prisma.studentConsent.deleteMany({ where: { studentId: { in: studentIds } } });
    await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
    await prisma.classSection.deleteMany({ where: { id: { in: sectionIds } } });
    await prisma.terminal.deleteMany({ where: { id: terminalId } });
    await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await prisma.$disconnect();
  }
});
