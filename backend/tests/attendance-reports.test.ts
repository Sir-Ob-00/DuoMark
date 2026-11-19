import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { authConfig } from "../src/config/auth.js";
import { digest } from "../src/services/auth.service.js";
import { updateSection } from "../src/services/class-section.service.js";
import { collectAllAuthorizedPages } from "../../frontend/src/api/reportPagination.js";

test("attendance reports: role scopes, closed/current assignments, dates and complete browser pagination", async () => {
  const unique = randomUUID();
  const staffIds: string[] = [];
  const studentIds: string[] = [];
  const courseIds: number[] = [];
  const sectionIds: string[] = [];
  const sessionIds: string[] = [];
  const cookies: string[] = [];
  const terminalId = `r-${unique}`;
  let deviceId: string | undefined;
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const request = (role: "admin" | "lecturer", query = "", cookie = role === "admin" ? cookies[0] : cookies[1]) => fetch(`${base}/${role}/reports/attendance${query ? `?${query}` : ""}`, { headers: cookie ? { Cookie: cookie } : {} });
  try {
    for (let i = 0; i < 3; i++) {
      const staff = await prisma.staff.create({ data: { name: `Opening lecturer ${i}`, email: `report-${i}-${unique}@example.test`, role: i === 0 ? "ADMIN" : "LECTURER" } });
      staffIds.push(staff.id);
      const token = randomBytes(32).toString("base64url");
      cookies.push(`${authConfig.cookieName}=${token}`);
      await prisma.staffSession.create({ data: { staffId: staff.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 60000) } });
    }
    for (let i = 0; i < 2; i++) {
      const course = await prisma.course.create({ data: { code: `REPORT-${i}-${unique}`.toUpperCase(), title: `Course ${i}` } });
      courseIds.push(course.id);
    }
    for (let i = 0; i < 3; i++) {
      const section = await prisma.classSection.create({ data: { code: `SECTION ${i}`, courseId: i === 2 ? courseIds[1] : courseIds[0], lecturerId: i === 1 ? staffIds[2] : staffIds[1], room: "Test", schedule: "Test", academicYear: "2026/2027", term: "TEST", isFictional: true } });
      sectionIds.push(section.id);
    }
    await prisma.terminal.create({ data: { id: terminalId, name: "Fictional report station", location: "Test", isFictional: true } });
    for (let i = 0; i < 6; i++) {
      const student = await prisma.student.create({ data: { studentId: `REPORT-${i}-${unique}`.toUpperCase(), name: `Report student ${i}`, program: "Test", department: "Test", level: "100", classSectionId: sectionIds[0], isFictional: true } });
      studentIds.push(student.id);
    }
    const device = await prisma.developmentCheckInDevice.create({ data: { terminalId, credentialHash: digest(randomBytes(32).toString("base64url")) } });
    deviceId = device.id;
    // closed own/current; open own/current; closed other/current; closed own/former;
    // closed own/current different course; closed other/other's current assignment.
    for (const [sectionIndex, opener, open] of [[0, 1, false], [0, 1, true], [0, 2, false], [1, 1, false], [2, 1, false], [1, 2, false]] as const) {
      const courseId = sectionIndex === 2 ? courseIds[1] : courseIds[0];
      const session = await prisma.attendanceSession.create({ data: { sectionId: sectionIds[sectionIndex], lecturerId: staffIds[opener], terminalId, courseId,
        courseCode: sectionIndex === 2 ? "COURSE 2" : "COURSE 1", courseName: "Original course name", sectionCode: `SECTION ${sectionIndex}`, room: "Test", academicYear: "2026/2027", term: "TEST",
        openedAt: new Date("2026-03-01T00:00:00Z"), status: open ? "OPEN" : "CLOSED", closedAt: open ? null : new Date("2026-03-05T00:00:00Z") } });
      sessionIds.push(session.id);
    }
    const times = ["2026-03-01T23:59:59.999Z", "2026-03-02T00:00:00.000Z", "2026-03-02T12:00:00.000Z", "2026-03-02T23:59:59.999Z", "2026-03-03T00:00:00.000Z", "2026-03-02T12:00:00.000Z"];
    const mainRecords: { id: string; recordedAt: Date }[] = [];
    for (let i = 0; i < times.length; i++) mainRecords.push(await prisma.attendanceRecord.create({ data: { sessionId: sessionIds[0], studentId: studentIds[i], studentIndexNumber: `INDEX-${i}`, studentName: `Recorded student ${i}`, deviceId, terminalId, recordedAt: new Date(times[i]) } }));
    for (let i = 1; i < sessionIds.length; i++) await prisma.attendanceRecord.create({ data: { sessionId: sessionIds[i], studentId: studentIds[0], studentIndexNumber: "INDEX-0", studentName: "Recorded student 0", deviceId, terminalId, recordedAt: new Date("2026-03-02T12:00:00Z") } });
    assert.equal((await request("admin", "", cookies[1])).status, 403);
    assert.equal((await request("lecturer", "", cookies[0])).status, 403);
    assert.equal((await request("admin", "", "")).status, 401);
    assert.equal((await request("lecturer", "", "")).status, 401);
    const filters = `courseId=${courseIds[0]}&sectionId=${sectionIds[0]}&lecturerId=${staffIds[1]}&dateFrom=2026-03-02&dateTo=2026-03-02`;
    const adminResponse = await request("admin", filters);
    assert.equal(adminResponse.status, 200);
    assert.equal(adminResponse.headers.get("cache-control"), "no-store");
    const admin = await adminResponse.json();
    assert.equal(admin.pagination.total, 5); // four closed rows plus one OPEN row
    assert.equal(admin.metadata.academicTimeZone, "UTC");
    assert.equal(admin.metadata.dateField, "recordedAt");
    assert.ok(admin.attendanceRecords.every((row: { lecturerId: string }) => row.lecturerId === staffIds[1]));
    assert.ok(admin.attendanceRecords.every((row: { lecturerName: string }) => row.lecturerName === "Opening lecturer 1"));
    const lecturerFilters = `courseId=${courseIds[0]}&sectionId=${sectionIds[0]}&dateFrom=2026-03-02&dateTo=2026-03-02`;
    const lecturer = await (await request("lecturer", lecturerFilters)).json();
    assert.equal(lecturer.pagination.total, 4);
    assert.equal(lecturer.metadata.scope, "closed-owned-currently-assigned-sections");
    assert.ok(lecturer.attendanceRecords.every((row: { sessionId: string }) => row.sessionId === sessionIds[0]));
    const expected = mainRecords.filter((_, index) => [1, 2, 3, 5].includes(index)).sort((left, right) => right.recordedAt.getTime() - left.recordedAt.getTime() || (left.id < right.id ? 1 : left.id > right.id ? -1 : 0)).map(row => row.id);
    assert.deepEqual(lecturer.attendanceRecords.map((row: { id: string }) => row.id), expected);
    const firstPage = await (await request("lecturer", lecturerFilters + "&page=1&limit=2")).json();
    const secondPage = await (await request("lecturer", lecturerFilters + "&page=2&limit=2")).json();
    assert.deepEqual(firstPage.pagination, { page: 1, limit: 2, total: 4, totalPages: 2 });
    assert.deepEqual([...firstPage.attendanceRecords, ...secondPage.attendanceRecords].map(row => row.id), expected);
    assert.equal((await (await request("lecturer", `sectionId=${sectionIds[1]}`)).json()).pagination.total, 0);
    assert.equal((await (await request("admin", `sectionId=${sectionIds[0]}&lecturerId=${staffIds[2]}`)).json()).pagination.total, 1);
    assert.equal((await (await request("lecturer", `sectionId=${sectionIds[0]}`, cookies[2])).json()).pagination.total, 0);
    for (const query of ["dateFrom=2026-02-30", "dateFrom=2026-03-03&dateTo=2026-03-02", "courseId=0", "sectionId=bad", "limit=101", "page=0", "dateTo[x]=y", "sectionId=a&sectionId=b"]) {
      assert.equal((await request("admin", query)).status, 400);
      assert.equal((await request("lecturer", query)).status, 400);
    }
    assert.equal((await request("lecturer", `lecturerId=${staffIds[2]}`)).status, 400);
    assert.equal((await request("admin", "lecturerId=bad")).status, 400);
    // The browser export collector fetches every real authorized backend page.
    const requestedPages: number[] = [];
    const all = await collectAllAuthorizedPages<{ id: string }>(async page => {
      requestedPages.push(page);
      const data = await (await request("lecturer", lecturerFilters + `&page=${page}&limit=2`)).json();
      return { items: data.attendanceRecords, pagination: data.pagination };
    });
    assert.deepEqual(requestedPages, [1, 2]);
    assert.deepEqual(all.map(row => row.id), expected);
    await updateSection(sectionIds[0], { lecturerId: staffIds[2] }, staffIds[0]);
    assert.equal((await (await request("lecturer", lecturerFilters)).json()).pagination.total, 0);
    const newAssignee = await (await request("lecturer", lecturerFilters, cookies[2])).json();
    assert.equal(newAssignee.pagination.total, 1); // only their own prior closed session
    assert.equal(newAssignee.attendanceRecords[0].sessionId, sessionIds[2]);
    assert.equal((await (await request("admin", filters)).json()).pagination.total, 5); // admin original-owner filter unchanged
    const history = await fetch(`${base}/sessions/${sessionIds[0]}/attendance`, { headers: { Cookie: cookies[1] } });
    assert.equal(history.status, 200); // broader history permission is intentionally unchanged
    await updateSection(sectionIds[0], { lecturerId: staffIds[1] }, staffIds[0]);
    assert.equal((await (await request("lecturer", lecturerFilters)).json()).pagination.total, 4);
    // Browser-generated exports: acknowledge only the supported report intent,
    // with the same role-specific predicate as the report read endpoint.
    const exportBody = { reportId: "attendance", filters: { courseId: courseIds[0], sectionId: sectionIds[0], lecturerId: staffIds[1], dateFrom: "2026-03-02", dateTo: "2026-03-02" }, requestId: randomUUID() };
    const acknowledge = (body: unknown, cookie = cookies[0], extraHeaders: Record<string, string> = {}) => fetch(`${base}/reports/exports`, { method: "POST", headers: { Origin: authConfig.origins[0], "X-CSRF-Protection": "1", "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders }, body: JSON.stringify(body) });
    const acknowledgements = await Promise.all(Array.from({ length: 4 }, () => acknowledge(exportBody)));
    assert.deepEqual(acknowledgements.map(response => response.status).sort(), [200, 200, 200, 201]);
    const receipts = await Promise.all(acknowledgements.map(response => response.json()));
    assert.equal(new Set(receipts.map(receipt => receipt.eventId)).size, 1);
    assert.equal(new Set(receipts.map(receipt => receipt.receivedAt)).size, 1);
    assert.equal(receipts.filter(receipt => !receipt.replayed).length, 1);
    assert.equal(receipts[0].outcome, "client-report-received");
    assert.deepEqual(Object.keys(receipts[0]).sort(), ["eventId", "outcome", "receivedAt", "replayed"]);
    const receipt = await prisma.auditEntry.findUniqueOrThrow({ where: { id: receipts[0].eventId } });
    assert.equal(receipt.actorId, staffIds[0]);
    assert.equal(receipt.deviceActorId, null);
    assert.equal(receipt.reportId, "attendance");
    assert.equal(receipt.action, "REPORT_EXPORT_REPORTED");
    assert.equal((receipt.details as { matchingRecordsAtReceipt: number }).matchingRecordsAtReceipt, admin.pagination.total);
    assert.equal(await prisma.auditEntry.count({ where: { actorId: staffIds[0], exportRequestId: exportBody.requestId } }), 1);
    assert.equal((await acknowledge({ ...exportBody, filters: { ...exportBody.filters, courseId: String(courseIds[0]) } })).status, 200);
    assert.equal((await acknowledge({ ...exportBody, filters: {} })).status, 409);
    const { lecturerId: _opener, ...ownFilters } = exportBody.filters;
    const ownExport = { reportId: "attendance", requestId: exportBody.requestId, filters: ownFilters };
    assert.equal((await acknowledge(ownExport, cookies[1])).status, 201); // request IDs are actor-scoped
    const lecturerReceipt = await prisma.auditEntry.findUniqueOrThrow({ where: { actorId_exportRequestId: { actorId: staffIds[1], exportRequestId: exportBody.requestId } } });
    assert.equal((lecturerReceipt.details as { matchingRecordsAtReceipt: number }).matchingRecordsAtReceipt, lecturer.pagination.total);
    assert.equal((lecturerReceipt.details as { role: string }).role, "LECTURER");
    assert.equal((await acknowledge(exportBody, cookies[1])).status, 400); // no arbitrary opening-lecturer filter
    await updateSection(sectionIds[0], { lecturerId: staffIds[2] }, staffIds[0]);
    const afterReassignment = await acknowledge({ ...ownExport, requestId: randomUUID() }, cookies[1]);
    assert.equal(afterReassignment.status, 201);
    const afterReceipt = await afterReassignment.json();
    assert.equal(((await prisma.auditEntry.findUniqueOrThrow({ where: { id: afterReceipt.eventId } })).details as { matchingRecordsAtReceipt: number }).matchingRecordsAtReceipt, 0);
    await updateSection(sectionIds[0], { lecturerId: staffIds[1] }, staffIds[0]);
    for (const invalid of [
      { ...exportBody, actorId: staffIds[2] }, { ...exportBody, role: "ADMIN" }, { ...exportBody, eventType: "STUDENT_UPDATED" }, { ...exportBody, csv: "student,name" },
      { ...exportBody, reportId: "other-report" }, { ...exportBody, requestId: "not-a-uuid" }, { ...exportBody, filters: { page: "1" } },
      { ...exportBody, filters: { sessionId: sessionIds[0] } }, { ...exportBody, filters: { dateFrom: "2026-02-30" } },
      { ...exportBody, filters: { dateFrom: "2026-03-03", dateTo: "2026-03-02" } }, { ...exportBody, filters: { sectionId: "bad" } },
    ]) assert.equal((await acknowledge(invalid)).status, 400);
    assert.equal((await acknowledge(exportBody, "")).status, 401);
    assert.equal((await acknowledge(exportBody, "", { Authorization: `Bearer ${randomBytes(32).toString("base64url")}` })).status, 401);
    assert.equal((await acknowledge(exportBody, cookies[0], { "X-CSRF-Protection": "" })).status, 403);
    const detailResponse = await fetch(`${base}/admin/audit-events/${receipt.id}`, { headers: { Cookie: cookies[0] } });
    const exportDetail = await detailResponse.json();
    assert.equal(exportDetail.event.action, "Received client-reported CSV export");
    assert.equal(exportDetail.event.actorDetails.id, staffIds[0]);
    assert.deepEqual(exportDetail.event.targetDetails, { type: "report", id: "attendance", label: "Attendance report" });
    assert.deepEqual(exportDetail.event.metadata.filters, exportBody.filters);
    assert.ok(!("requestHash" in exportDetail.event.metadata));
    assert.ok(!JSON.stringify(exportDetail).includes(exportBody.requestId));
    const exportList = await (await fetch(`${base}/admin/audit-events?actorId=${staffIds[0]}&eventType=REPORT_EXPORT_REPORTED&targetType=report&targetId=attendance&search=CSV`, { headers: { Cookie: cookies[0] } })).json();
    assert.equal(exportList.pagination.total, 1);
    assert.equal(exportList.auditEvents[0].id, receipt.id);
    let builtCsv = false;
    await assert.rejects(collectAllAuthorizedPages<{ id: string }>(async page => {
      if (page === 2) throw new Error("Second authorized page failed");
      return { items: [{ id: "row-1" }], pagination: { page, limit: 1, total: 2, totalPages: 2 } };
    }).then(() => { builtCsv = true; }));
    assert.equal(builtCsv, false);
    await assert.rejects(collectAllAuthorizedPages(async page => ({ items: [{ id: "duplicate" }], pagination: { page, limit: 1, total: 2, totalPages: 2 } })));
    await assert.rejects(collectAllAuthorizedPages(async page => ({ items: [{ id: `row-${page}` }], pagination: { page, limit: 1, total: page === 1 ? 2 : 3, totalPages: page === 1 ? 2 : 3 } })));
    assert.ok(!Object.keys(lecturer.attendanceRecords[0]).some(key => /consent|biometric|score|email|template|attempt|credential/i.test(key)));
    assert.equal((await fetch(base.replace("/api/v1", "/health"))).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await prisma.auditEntry.deleteMany({ where: { actorId: { in: staffIds } } });
    if (deviceId) { await prisma.attendanceRecord.deleteMany({ where: { deviceId } }); await prisma.developmentCheckInDevice.delete({ where: { id: deviceId } }); }
    await prisma.attendanceSession.deleteMany({ where: { id: { in: sessionIds } } });
    await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
    await prisma.classSection.deleteMany({ where: { id: { in: sectionIds } } });
    await prisma.terminal.deleteMany({ where: { id: terminalId } });
    await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await prisma.$disconnect();
  }
});
