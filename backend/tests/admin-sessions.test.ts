import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { authConfig } from "../src/config/auth.js";
import { digest } from "../src/services/auth.service.js";
import { adminSessionQuery } from "../src/validation/admin-session.validation.js";
import { updateSection } from "../src/services/class-section.service.js";

test("admin session views: combined filters, UTC dates, pagination, privacy and historical ownership", async () => {
  const unique = randomUUID();
  const staffIds: string[] = [];
  const sectionIds: string[] = [];
  const sessionIds: string[] = [];
  const cookies: string[] = [];
  const terminalId = `a-${unique}`;
  let courseId: number | undefined;
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const root = "/api/v1/admin/sessions";
  const request = (suffix = "", cookie = cookies[0]) => fetch(base + root + suffix, { headers: { Cookie: cookie } });
  const rows: { id: string; openedAt: Date; status: string; lecturerId: string; sectionId: string }[] = [];
  try {
    for (let i = 0; i < 3; i++) {
      const staff = await prisma.staff.create({ data: { email: `admin-session-${i}-${unique}@example.test`, name: `Directory name ${i}`, role: i === 0 ? "ADMIN" : "LECTURER" } });
      staffIds.push(staff.id);
      const token = randomBytes(32).toString("base64url");
      cookies.push(`${authConfig.cookieName}=${token}`);
      await prisma.staffSession.create({ data: { staffId: staff.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 60000) } });
    }
    const course = await prisma.course.create({ data: { code: `ADMIN-${unique}`.toUpperCase(), title: "Current catalog title" } });
    courseId = course.id;
    await prisma.terminal.create({ data: { id: terminalId, name: "Admin Station", location: "Lab" } });
    for (let i = 0; i < 2; i++) {
      const section = await prisma.classSection.create({ data: { code: `CLASS ${i}`, courseId, lecturerId: staffIds[1], room: "Current room", schedule: "Mon", academicYear: "2026/2027", term: "SEMESTER 1" } });
      sectionIds.push(section.id);
    }
    const fixtures = [
      ["2026-03-01T23:59:59.999Z", 1, 0, "CLOSED"],
      ["2026-03-02T00:00:00.000Z", 1, 0, "CLOSED"],
      ["2026-03-02T12:00:00.000Z", 1, 0, "OPEN"],
      ["2026-03-02T23:59:59.999Z", 1, 0, "CLOSED"],
      ["2026-03-03T00:00:00.000Z", 1, 0, "CLOSED"],
      ["2026-03-02T12:00:00.000Z", 2, 0, "CLOSED"],
      ["2026-03-02T12:00:00.000Z", 1, 1, "CLOSED"],
      ["2026-03-02T12:00:00.000Z", 1, 0, "CLOSED"],
    ] as const;
    for (const [time, lecturer, section, status] of fixtures) {
      const row = await prisma.attendanceSession.create({ data: { lecturerId: staffIds[lecturer], sectionId: sectionIds[section], terminalId, courseId,
        courseCode: "HIST 101", courseName: "Opening catalog title", sectionCode: "OPENING SECTION", room: "Opening room",
        academicYear: "2025/2026", term: "SEMESTER 2", status, openedAt: new Date(time), closedAt: status === "CLOSED" ? new Date("2026-03-05T00:00:00Z") : null } });
      rows.push(row);
      sessionIds.push(row.id);
    }
    for (const suffix of ["", `/${sessionIds[0]}`]) {
      assert.equal((await request(suffix, cookies[1])).status, 403);
      assert.equal((await request(suffix, cookies[2])).status, 403);
      assert.equal((await request(suffix, "")).status, 401);
    }
    const filters = `lecturerId=${staffIds[1]}&sectionId=${sectionIds[0]}&dateFrom=2026-03-02&dateTo=2026-03-02`;
    const combined = await request(`?${filters}&status=Closed`);
    assert.equal(combined.status, 200);
    assert.equal(combined.headers.get("cache-control"), "no-store");
    const data = await combined.json();
    assert.equal(data.pagination.total, 3);
    assert.ok(data.sessions.every((row: { lecturerId: string; sectionId: string; status: string }) => row.lecturerId === staffIds[1] && row.sectionId === sectionIds[0] && row.status === "Closed"));
    const allDay = await (await request(`?${filters}`)).json();
    const expected = [rows[1], rows[2], rows[3], rows[7]].sort((left, right) => right.openedAt.getTime() - left.openedAt.getTime() || (left.id < right.id ? 1 : left.id > right.id ? -1 : 0));
    assert.deepEqual(allDay.sessions.map((row: { id: string }) => row.id), expected.map(row => row.id));
    assert.equal(allDay.sessions.some((row: { id: string }) => row.id === rows[0].id || row.id === rows[4].id), false);
    assert.equal(allDay.pagination.total, 4); // both midnights and 23:59:59.999 boundaries checked
    const firstPage = await (await request(`?${filters}&limit=2&page=1`)).json();
    const secondPage = await (await request(`?${filters}&limit=2&page=2`)).json();
    assert.deepEqual(firstPage.pagination, { page: 1, limit: 2, total: 4, totalPages: 2 });
    assert.deepEqual([...firstPage.sessions, ...secondPage.sessions].map(row => row.id), expected.map(row => row.id));
    assert.deepEqual((await (await request(`?${filters}&limit=2&page=3`)).json()).sessions, []);
    assert.equal((await (await request(`?${filters}&status=Open`)).json()).pagination.total, 1);
    const fromOnly = await (await request(`?lecturerId=${staffIds[1]}&sectionId=${sectionIds[0]}&dateFrom=2026-03-02`)).json();
    assert.ok(fromOnly.sessions.some((row: { id: string }) => row.id === rows[4].id));
    assert.equal(fromOnly.sessions.some((row: { id: string }) => row.id === rows[0].id), false);
    const toOnly = await (await request(`?lecturerId=${staffIds[1]}&sectionId=${sectionIds[0]}&dateTo=2026-03-02`)).json();
    assert.ok(toOnly.sessions.some((row: { id: string }) => row.id === rows[0].id));
    assert.equal(toOnly.sessions.some((row: { id: string }) => row.id === rows[4].id), false);
    const secondSection = await (await request(`?lecturerId=${staffIds[1]}&sectionId=${sectionIds[1]}`)).json();
    assert.deepEqual(secondSection.sessions.map((row: { id: string }) => row.id), [rows[6].id]);
    assert.equal((await (await request(`?lecturerId=${randomUUID()}`)).json()).pagination.total, 0);
    for (const query of ["dateFrom=2026-02-30", "dateTo=2025-02-29", "dateFrom=2026-13-01", "dateFrom=0000-01-01", "dateFrom=2026-3-02", "dateFrom=not-a-date", "dateFrom=2026-03-02T00%3A00%3A00Z", "dateFrom=2026-03-03&dateTo=2026-03-02", "dateFrom=2026-03-02&dateFrom=2026-03-03", "status=Scheduled", "lecturerId=bad", "sectionId=bad", "courseId=1", "page=0", "limit=101", "dateTo[x]=y"]) {
      assert.equal((await request(`?${query}`)).status, 400);
    }
    assert.equal((await request("?dateFrom=2024-02-29&dateTo=2024-02-29")).status, 200);
    assert.equal((await request(`/${randomUUID()}`)).status, 404);
    assert.equal((await request("/not-a-uuid")).status, 400);

    await updateSection(sectionIds[0], { lecturerId: staffIds[2], room: "Reassigned room" }, staffIds[0]);
    const detailResponse = await request(`/${rows[1].id}`);
    assert.equal(detailResponse.status, 200);
    const detail = (await detailResponse.json()).session;
    assert.equal(detail.lecturerId, staffIds[1]);
    assert.deepEqual(detail.lecturer, { id: staffIds[1], name: "Directory name 1", email: `admin-session-1-${unique}@example.test` });
    assert.deepEqual(detail.section, { id: sectionIds[0], code: "OPENING SECTION", courseId, room: "Opening room", academicYear: "2025/2026", term: "SEMESTER 2" });
    assert.deepEqual(detail.course, { id: courseId, code: "HIST 101", name: "Opening catalog title" });
    assert.deepEqual(detail.terminal, { id: terminalId, name: "Admin Station", location: "Lab", status: "Available" });
    assert.equal(detail.openedAt, "2026-03-02T00:00:00.000Z");
    assert.equal(detail.closedAt, "2026-03-05T00:00:00.000Z");
    assert.deepEqual(detail.attendance, []);
    assert.equal(detail.roster, undefined);
    assert.equal(detail.consent, undefined);
    assert.equal(detail.lecturer.passwordHash, undefined);
    // Filter historical ownership using the stored opener, not today's assignee.
    assert.equal((await (await request(`?${filters}&status=Closed`)).json()).pagination.total, 3);
    const currentOwnerFilter = await (await request(`?lecturerId=${staffIds[2]}&sectionId=${sectionIds[0]}`)).json();
    assert.deepEqual(currentOwnerFilter.sessions.map((row: { id: string }) => row.id), [rows[5].id]);
    // Date conversion remains explicitly UTC regardless of the host's TZ.
    const oldTz = process.env.TZ;
    try {
      process.env.TZ = "America/Los_Angeles";
      const dates = adminSessionQuery({ dateFrom: "2026-03-02", dateTo: "2026-03-02" });
      assert.equal(dates.dateFrom?.toISOString(), "2026-03-02T00:00:00.000Z");
      assert.equal(dates.dateToExclusive?.toISOString(), "2026-03-03T00:00:00.000Z");
    } finally { if (oldTz === undefined) delete process.env.TZ; else process.env.TZ = oldTz; }
    assert.equal((await fetch(base + "/health")).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await prisma.auditEntry.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.attendanceSession.deleteMany({ where: { id: { in: sessionIds } } });
    await prisma.classSection.deleteMany({ where: { id: { in: sectionIds } } });
    await prisma.terminal.deleteMany({ where: { id: terminalId } });
    if (courseId) await prisma.course.delete({ where: { id: courseId } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await prisma.$disconnect();
  }
});
