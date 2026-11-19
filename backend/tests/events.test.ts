import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { authConfig } from "../src/config/auth.js";
import { digest } from "../src/services/auth.service.js";
import { openSession, closeSession } from "../src/services/attendance-session.service.js";
import { publishChange, subscribeChanges } from "../src/services/events.service.js";

test("SSE: opener/station isolation, committed hints, reconnect, revocation and expiry", async () => {
  const previous = { mode: process.env.CHECK_IN_MODE, environment: process.env.NODE_ENV, events: process.env.EVENTS_ENABLED };
  process.env.NODE_ENV = "test"; process.env.CHECK_IN_MODE = "development-fake"; process.env.EVENTS_ENABLED = "true";
  const unique = randomUUID();
  const staffIds: string[] = [], cookies: string[] = [], tokens: string[] = [], sectionIds: string[] = [];
  const terminalIds = [`e-${unique}`, `f-${unique}`];
  const deviceToken = randomBytes(32).toString("base64url");
  let courseId: number | undefined, deviceId: string | undefined;
  const connections: AbortController[] = [];
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  async function connect(headers: Record<string, string>, query = "") {
    const controller = new AbortController(); connections.push(controller);
    const response = await fetch(`${base}/events${query}`, { headers, signal: controller.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type")!, /^text\/event-stream/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const messages: { type: string; data: Record<string, string> }[] = [];
    const reader = response.body!.getReader();
    const done = (async () => {
      let buffer = ""; const decoder = new TextDecoder();
      try {
        while (true) {
          const part = await reader.read(); if (part.done) return;
          buffer += decoder.decode(part.value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const type = frame.match(/^event: (.+)$/m)?.[1], data = frame.match(/^data: (.+)$/m)?.[1];
            if (type && data) messages.push({ type, data: JSON.parse(data) });
          }
        }
      } catch (error) { if (!controller.signal.aborted) throw error; }
    })();
    async function waitFor(predicate: () => boolean) {
      const deadline = Date.now() + 3000;
      while (!predicate()) { if (Date.now() > deadline) assert.fail("SSE message timed out"); await new Promise(resolve => setTimeout(resolve, 10)); }
    }
    await waitFor(() => messages.some(message => message.type === "ready"));
    return { messages, waitFor, done, disconnect: async () => { controller.abort(); await done; } };
  }
  try {
    for (let i = 0; i < 3; i++) {
      const staff = await prisma.staff.create({ data: { name: `SSE ${i}`, email: `sse-${i}-${unique}@example.test`, role: i === 2 ? "ADMIN" : "LECTURER" } }); staffIds.push(staff.id);
      const token = randomBytes(32).toString("base64url"); tokens.push(token); cookies.push(`${authConfig.cookieName}=${token}`);
      await prisma.staffSession.create({ data: { staffId: staff.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 60000) } });
    }
    courseId = (await prisma.course.create({ data: { code: `SSE-${unique}`.toUpperCase(), title: "SSE test" } })).id;
    for (let i = 0; i < 2; i++) {
      sectionIds.push((await prisma.classSection.create({ data: { code: `SECTION ${i}`, courseId, lecturerId: staffIds[i], academicYear: "2026/2027", term: "TEST", room: "Test", schedule: "Test", isFictional: true } })).id);
      await prisma.terminal.create({ data: { id: terminalIds[i], name: `Station ${i}`, location: "Test", isFictional: true } });
    }
    deviceId = (await prisma.developmentCheckInDevice.create({ data: { terminalId: terminalIds[0], credentialHash: digest(deviceToken) } })).id;
    assert.equal((await fetch(`${base}/events`)).status, 401);
    assert.equal((await fetch(`${base}/events`, { headers: { Cookie: cookies[2] } })).status, 403);
    assert.equal((await fetch(`${base}/events?terminalId=${terminalIds[0]}`)).status, 401);
    assert.equal((await fetch(`${base}/events?terminalId=${terminalIds[0]}`, { headers: { Cookie: cookies[0] } })).status, 401);
    assert.equal((await fetch(`${base}/events?terminalId=${terminalIds[1]}`, { headers: { Authorization: `Bearer ${deviceToken}` } })).status, 403);
    assert.equal((await fetch(`${base}/events?lecturerId=${staffIds[1]}`, { headers: { Cookie: cookies[0] } })).status, 400);
    const first = await connect({ Cookie: cookies[0] }), second = await connect({ Cookie: cookies[1] });
    const device = await connect({ Authorization: `Bearer ${deviceToken}` }, `?terminalId=${terminalIds[0]}`);
    const committedChecks: Promise<void>[] = [];
    const unsubscribe = subscribeChanges(change => { committedChecks.push((async () => {
      const row = await prisma.attendanceSession.findUniqueOrThrow({ where: { id: change.sessionId } });
      assert.equal(row.status, change.type === "session-closed" ? "CLOSED" : "OPEN");
    })()); });
    const other = await openSession({ sectionId: sectionIds[1], terminalId: terminalIds[1] }, staffIds[1]);
    await second.waitFor(() => second.messages.length === 2);
    const own = await openSession({ sectionId: sectionIds[0], terminalId: terminalIds[0] }, staffIds[0]);
    await first.waitFor(() => first.messages.length === 2); await device.waitFor(() => device.messages.length === 2);
    await Promise.all(committedChecks); unsubscribe();
    await assert.rejects(openSession({ sectionId: sectionIds[0], terminalId: terminalIds[0] }, staffIds[0]));
    assert.deepEqual(first.messages[1], { type: "session-opened", data: { sessionId: own.id } });
    assert.deepEqual(second.messages[1], { type: "session-opened", data: { sessionId: other.id } });
    assert.deepEqual(device.messages[1], first.messages[1]);
    // Check-in hints reach only the opening lecturer, never station subscribers.
    publishChange({ type: "attendance-recorded", sessionId: own.id, terminalId: terminalIds[0] });
    await first.waitFor(() => first.messages.length === 3);
    await first.disconnect();
    await closeSession(own.id, staffIds[0]); await closeSession(own.id, staffIds[0]);
    await device.waitFor(() => device.messages.length === 3);
    assert.deepEqual(device.messages.map(message => message.type), ["ready", "session-opened", "session-closed"]);
    assert.equal(second.messages.length, 2);
    const reconnected = await connect({ Cookie: cookies[0] });
    assert.deepEqual(reconnected.messages, [{ type: "ready", data: {} }]);
    // The reconnect's ready hint triggers the same authorized state reload used
    // by the dashboard; no replay assumption is necessary.
    const recovered = await (await fetch(`${base}/lecturer/sessions/${own.id}`, { headers: { Cookie: cookies[0] } })).json();
    assert.equal(recovered.session.status, "Closed");
    await prisma.staffSession.deleteMany({ where: { tokenHash: digest(tokens[0]) } });
    publishChange({ type: "session-closed", sessionId: own.id, terminalId: terminalIds[0] });
    await reconnected.done;
    await device.waitFor(() => device.messages.length === 4);
    assert.equal(reconnected.messages.length, 1);
    assert.equal((await fetch(`${base}/events`, { headers: { Cookie: cookies[0] } })).status, 401);
    await prisma.staffSession.updateMany({ where: { tokenHash: digest(tokens[1]) }, data: { expiresAt: new Date(Date.now() - 1) } });
    publishChange({ type: "session-opened", sessionId: other.id, terminalId: terminalIds[1] });
    await second.done;
    assert.equal(second.messages.length, 2);
    await prisma.developmentCheckInDevice.update({ where: { id: deviceId }, data: { active: false } });
    publishChange({ type: "session-opened", sessionId: own.id, terminalId: terminalIds[0] });
    await device.done;
    assert.equal(device.messages.length, 4); // genuine close plus explicit revoked-staff test hint, no post-device-revocation hint
  } finally {
    connections.forEach(controller => controller.abort());
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await prisma.auditEntry.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.attendanceSession.deleteMany({ where: { sectionId: { in: sectionIds } } });
    if (deviceId) await prisma.developmentCheckInDevice.delete({ where: { id: deviceId } });
    await prisma.terminal.deleteMany({ where: { id: { in: terminalIds } } });
    await prisma.classSection.deleteMany({ where: { id: { in: sectionIds } } });
    if (courseId) await prisma.course.delete({ where: { id: courseId } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } }); await prisma.$disconnect();
    for (const [key, value] of Object.entries({ CHECK_IN_MODE: previous.mode, NODE_ENV: previous.environment, EVENTS_ENABLED: previous.events })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
