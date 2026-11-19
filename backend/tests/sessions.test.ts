import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { authConfig } from "../src/config/auth.js";
import { digest } from "../src/services/auth.service.js";
import { setTerminalAvailability } from "../src/services/terminal.service.js";
import { updateSection } from "../src/services/class-section.service.js";
import { closeSession, openSession } from "../src/services/attendance-session.service.js";

test("lecturer sessions: lifecycle, exclusive terminals, opener scope and bounded recent history", async () => {
  const unique = randomUUID();
  const staffIds: string[] = [];
  const sectionIds: string[] = [];
  const cookies: string[] = [];
  const terminalIds = [`s-${unique}`, `t-${unique}`];
  let courseId: number | undefined;
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const root = "/lecturer/sessions";
  const request = (path = root, method = "GET", body?: unknown, cookie = cookies[1]) => fetch(base + path, {
    method, headers: { Origin: authConfig.origins[0], "X-CSRF-Protection": "1", Cookie: cookie, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    for (let i = 0; i < 3; i++) {
      const staff = await prisma.staff.create({ data: { email: `session-${i}-${unique}@example.test`, name: `Session fixture ${i}`, role: i === 0 ? "ADMIN" : "LECTURER" } });
      staffIds.push(staff.id);
      const token = randomBytes(32).toString("base64url");
      cookies.push(`${authConfig.cookieName}=${token}`);
      await prisma.staffSession.create({ data: { staffId: staff.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 60000) } });
    }
    const course = await prisma.course.create({ data: { code: `SESSION-${unique}`.toUpperCase(), title: "Session Course" } });
    courseId = course.id;
    for (let i = 0; i < 2; i++) {
      const section = await prisma.classSection.create({ data: { code: `SECTION ${i}`, courseId, lecturerId: staffIds[i + 1], room: `Room ${i}`, schedule: "Mon 09:00", academicYear: "2026/2027", term: "SEMESTER 1" } });
      sectionIds.push(section.id);
      await prisma.terminal.create({ data: { id: terminalIds[i], name: `Station ${i}`, location: "Lab" } });
    }
    const input = { sectionId: sectionIds[0], terminalId: terminalIds[0] };
    const nonexistent = randomUUID();
    for (const [path, method, body] of [[root, "GET", undefined], [root, "POST", input], [`${root}/${nonexistent}`, "GET", undefined], [`${root}/${nonexistent}/close`, "POST", undefined]] as const) {
      assert.equal((await request(path, method, body, cookies[0])).status, 403);
      assert.equal((await request(path, method, body, "")).status, 401);
    }
    assert.equal((await request(root, "POST", { ...input, sectionId: sectionIds[1] })).status, 403);
    assert.equal((await request(root, "POST", { ...input, sectionId: nonexistent })).status, 404);
    assert.equal((await request(root, "POST", { ...input, terminalId: "missing-station" })).status, 404);
    for (const extra of [{ lecturerId: staffIds[2] }, { openedAt: new Date().toISOString() }, { status: "Open" }, { attendance: [] }]) assert.equal((await request(root, "POST", { ...input, ...extra })).status, 400);
    assert.equal((await request(root, "POST", { ...input, terminalId: "INVALID" })).status, 400);
    await setTerminalAvailability(terminalIds[0], "Unavailable", staffIds[0]);
    assert.equal((await request(root, "POST", input)).status, 409);
    await setTerminalAvailability(terminalIds[0], "Available", staffIds[0]);
    const startedAfter = Date.now();
    const created = await request(root, "POST", input);
    assert.equal(created.status, 201);
    const session = (await created.json()).session;
    assert.equal(created.headers.get("location"), `/api/v1${root}/${session.id}`);
    assert.equal(session.status, "Open");
    assert.equal(session.lecturerId, staffIds[1]);
    assert.ok(Date.parse(session.openedAt) >= startedAfter - 1000);
    assert.equal(session.closedAt, null);
    const detail = await request(`${root}/${session.id}`);
    assert.equal(detail.status, 200);
    assert.deepEqual((await detail.json()).session.attendance, []);
    assert.equal((await request(`${root}/${session.id}`, "GET", undefined, cookies[2])).status, 404);
    assert.equal((await request(`${root}/${session.id}/close`, "POST", undefined, cookies[2])).status, 404);
    assert.equal((await request(`${root}/bad-id`)).status, 400);
    assert.equal((await request(`${root}/${nonexistent}`)).status, 404);
    assert.equal((await request(root, "POST", input)).status, 409);
    const stationPath = `/admin/terminals/${terminalIds[0]}`;
    const occupied = (await (await request(stationPath, "GET", undefined, cookies[0])).json()).terminal;
    assert.equal(occupied.sessionId, session.id);
    assert.equal(occupied.activeSession.id, session.id);
    assert.equal(occupied.status, "Available");
    const stations = await (await request(`/admin/terminals?search=${terminalIds[0]}`, "GET", undefined, cookies[0])).json();
    assert.equal(stations.terminals[0].activeSession.id, session.id);
    await setTerminalAvailability(terminalIds[0], "Unavailable", staffIds[0]);
    assert.equal((await (await request(`${root}/${session.id}`)).json()).session.status, "Open");
    assert.equal((await (await request(stationPath, "GET", undefined, cookies[0])).json()).terminal.activeSession.id, session.id);
    const closedResponses = await Promise.all([request(`${root}/${session.id}/close`, "POST"), request(`${root}/${session.id}/close`, "POST")]);
    assert.deepEqual(closedResponses.map(response => response.status), [200, 200]);
    const closed = (await closedResponses[0].json()).session;
    assert.equal(closed.status, "Closed");
    assert.equal((await closedResponses[1].json()).session.closedAt, closed.closedAt);
    assert.equal((await (await request(`${root}/${session.id}/close`, "POST")).json()).session.closedAt, closed.closedAt);
    assert.equal(await prisma.auditEntry.count({ where: { attendanceSessionId: session.id, action: "SESSION_CLOSED" } }), 1);
    assert.equal((await (await request(stationPath, "GET", undefined, cookies[0])).json()).terminal.activeSession, null);
    await setTerminalAvailability(terminalIds[0], "Available", staffIds[0]);

    // Different assigned sections/lecturers compete for the same available station.
    const competing = await Promise.all([request(root, "POST", input), request(root, "POST", { sectionId: sectionIds[1], terminalId: terminalIds[0] }, cookies[2])]);
    assert.deepEqual(competing.map(response => response.status).sort(), [201, 409]);
    const winner = (await competing.find(response => response.status === 201)!.json()).session;
    assert.equal(await prisma.attendanceSession.count({ where: { terminalId: terminalIds[0], status: "OPEN" } }), 1);
    // The database guard also applies to writes outside the opening service.
    const winnerRow = await prisma.attendanceSession.findUniqueOrThrow({ where: { id: winner.id } });
    const { id: _winnerId, ...duplicate } = winnerRow;
    await assert.rejects(prisma.attendanceSession.create({ data: duplicate }));
    await closeSession(winner.id, winner.lecturerId);

    // Ownership and snapshot labels survive reassignment, including an OPEN session.
    const ownerSession = await openSession({ sectionId: sectionIds[0], terminalId: terminalIds[0] }, staffIds[1]);
    await updateSection(sectionIds[0], { lecturerId: staffIds[2], room: "Changed Room" }, staffIds[0]);
    assert.equal((await request(`${root}/${ownerSession.id}`)).status, 200);
    assert.equal((await request(`${root}/${ownerSession.id}`, "GET", undefined, cookies[2])).status, 404);
    const newOwnerClasses = await (await request("/lecturer/classes", "GET", undefined, cookies[2])).json();
    assert.deepEqual(newOwnerClasses.classes.find((row: { id: string }) => row.id === sectionIds[0]).recentSessions, []);
    assert.equal((await request(root, "POST", input)).status, 403);
    assert.equal((await request(`${root}/${ownerSession.id}/close`, "POST")).status, 200);
    const snapshot = (await (await request(`${root}/${ownerSession.id}`)).json()).session;
    assert.equal(snapshot.lecturerId, staffIds[1]);
    assert.equal(snapshot.room, "Room 0");
    await updateSection(sectionIds[0], { lecturerId: staffIds[1] }, staffIds[0]);

    // Create enough authorized history to verify a per-section bound of ten.
    for (let i = 0; i < 11; i++) {
      const entry = await openSession(input, staffIds[1]);
      await closeSession(entry.id, staffIds[1]);
    }
    const classes = await (await request("/lecturer/classes")).json();
    const recent = classes.classes.find((row: { id: string }) => row.id === sectionIds[0]).recentSessions;
    assert.equal(recent.length, 10);
    assert.ok(recent.every((row: { lecturerId: string }) => row.lecturerId === staffIds[1]));
    const active = await openSession(input, staffIds[1]);
    const activeList = await (await request(`${root}?view=active&page=1&limit=1`)).json();
    assert.equal(activeList.pagination.total, 1);
    assert.equal(activeList.sessions[0].id, active.id);
    const history = await (await request(`${root}?view=history&page=1&limit=2`)).json();
    assert.equal(history.sessions.length, 2);
    assert.ok(history.sessions.every((row: { status: string; lecturerId: string }) => row.status === "Closed" && row.lecturerId === staffIds[1]));
    const otherHistory = await (await request(root, "GET", undefined, cookies[2])).json();
    assert.ok(otherHistory.sessions.every((row: { lecturerId: string }) => row.lecturerId === staffIds[2]));
    for (const query of ["view=bad", "page=0", "limit=101", `lecturerId=${staffIds[2]}`, "view=active&view=history"]) assert.equal((await request(`${root}?${query}`)).status, 400);
    assert.equal((await request(`${root}/${active.id}/close`, "POST", { closedAt: new Date().toISOString() })).status, 400);
    await closeSession(active.id, staffIds[1]);
    const openAudit = await prisma.auditEntry.findFirstOrThrow({ where: { attendanceSessionId: session.id, action: "SESSION_OPENED" } });
    assert.equal(openAudit.actorId, staffIds[1]);
    const closeAudit = await prisma.auditEntry.findFirstOrThrow({ where: { attendanceSessionId: session.id, action: "SESSION_CLOSED" } });
    assert.equal(closeAudit.actorId, staffIds[1]);
    assert.equal((await fetch(base.replace("/api/v1", "/health"))).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await prisma.auditEntry.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.attendanceSession.deleteMany({ where: { sectionId: { in: sectionIds } } });
    await prisma.classSection.deleteMany({ where: { id: { in: sectionIds } } });
    await prisma.terminal.deleteMany({ where: { id: { in: terminalIds } } });
    if (courseId) await prisma.course.delete({ where: { id: courseId } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await prisma.$disconnect();
  }
});
