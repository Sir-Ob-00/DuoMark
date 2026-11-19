import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { authConfig } from "../src/config/auth.js";
import { digest } from "../src/services/auth.service.js";
import { createTerminal, updateTerminal, setTerminalAvailability, lockTerminalForNewSession } from "../src/services/terminal.service.js";

test("terminal registration, admin authorization, availability policy and atomic audit", async () => {
  const unique = randomUUID();
  const id = `t-${unique}`;
  const terminalIds = [id, `${id}-2`, `r-${unique}`];
  const staffIds: string[] = [];
  const cookies: string[] = [];
  const root = "/api/v1/admin/terminals";
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const request = (path = "", method = "GET", body?: unknown, cookie = cookies[0], headers: Record<string, string> = {}) => fetch(base + root + path, {
    method, headers: { Origin: authConfig.origins[0], "X-CSRF-Protection": "1", "Content-Type": "application/json", Cookie: cookie, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    for (const role of ["ADMIN", "LECTURER"] as const) {
      const staff = await prisma.staff.create({ data: { email: `${role}-terminal-${unique}@example.test`, name: "Terminal staff", role } });
      staffIds.push(staff.id);
      const token = randomBytes(32).toString("base64url");
      cookies.push(`${authConfig.cookieName}=${token}`);
      await prisma.staffSession.create({ data: { staffId: staff.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 60000) } });
    }
    for (const [path, method] of [["", "GET"], ["", "POST"], [`/${id}`, "GET"], [`/${id}`, "PATCH"], [`/${id}/availability`, "PATCH"]]) {
      assert.equal((await request(path, method, method === "GET" ? undefined : {}, cookies[1])).status, 403);
      assert.equal((await request(path, method, method === "GET" ? undefined : {}, "")).status, 401);
    }
    const input = { id: ` ${id.toUpperCase()} `, name: " Main Station ", location: " Computing Lab " };
    assert.equal((await request("", "POST", input, cookies[0], { "X-CSRF-Protection": "" })).status, 403);
    const registered = await request("", "POST", input);
    assert.equal(registered.status, 201);
    assert.equal(registered.headers.get("location"), `${root}/${id}`);
    const terminal = (await registered.json()).terminal;
    assert.deepEqual(terminal, { id, name: "Main Station", location: "Computing Lab", status: "Available", sessionId: null, activeSession: null });
    assert.deepEqual((await (await request(`/${id}`)).json()).terminal, terminal);
    assert.equal((await request("", "POST", { ...input, id })).status, 409);
    assert.equal(await prisma.auditEntry.count({ where: { terminalId: id, action: "TERMINAL_REGISTERED" } }), 1);
    const simultaneous = await Promise.all([request("", "POST", { ...input, id: terminalIds[1] }), request("", "POST", { ...input, id: terminalIds[1] })]);
    assert.deepEqual(simultaneous.map(response => response.status).sort(), [201, 409]);
    for (const invalid of ["x", "bad--id", "trailing-", "-leading", "bad_id", "bad id", "A".repeat(41)]) {
      assert.equal((await request("", "POST", { ...input, id: invalid })).status, 400);
    }
    for (const invalid of ["x", "bad--id", "BAD-ID", "bad_id", "trailing-"]) {
      assert.equal((await request(`/${invalid}`)).status, 400);
      assert.equal((await request(`/${invalid}`, "PATCH", { name: "Updated" })).status, 400);
      assert.equal((await request(`/${invalid}/availability`, "PATCH", { status: "Unavailable" })).status, 400);
    }
    assert.equal((await request("/missing-station")).status, 404);
    assert.equal((await request("/missing-station", "PATCH", { name: "Missing" })).status, 404);
    assert.equal((await request("/missing-station/availability", "PATCH", { status: "Unavailable" })).status, 404);
    for (const body of [{}, { name: " " }, { location: null }, { id: "renamed" }, { status: "Unavailable" }, { sessionId: "fake" }, { activeSession: {} }, { deviceSecret: "forbidden" }]) {
      assert.equal((await request(`/${id}`, "PATCH", body)).status, 400);
    }
    for (const body of [{ ...input, status: "Unavailable" }, { ...input, deviceSecret: "forbidden" }, [], null]) assert.equal((await request("", "POST", body)).status, 400);
    const changed = await request(`/${id}`, "PATCH", { name: "Updated Station", location: "Lab 2" });
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).terminal.id, id);
    const profileAudit = await prisma.auditEntry.findFirstOrThrow({ where: { terminalId: id, action: "TERMINAL_UPDATED" } });
    assert.equal(profileAudit.actorId, staffIds[0]);
    assert.deepEqual(profileAudit.details, { changedFields: ["name", "location"], before: { name: "Main Station", location: "Computing Lab" }, after: { name: "Updated Station", location: "Lab 2" } });
    const allowed = await prisma.$transaction(tx => lockTerminalForNewSession(tx, id));
    assert.equal(allowed.id, id);
    const unavailable = await request(`/${id}/availability`, "PATCH", { status: "Unavailable" });
    assert.equal(unavailable.status, 200);
    assert.deepEqual((await unavailable.json()).terminal, { id, name: "Updated Station", location: "Lab 2", status: "Unavailable", sessionId: null, activeSession: null });
    await assert.rejects(prisma.$transaction(tx => lockTerminalForNewSession(tx, id)), error => error instanceof Error && error.message === "Terminal is unavailable for new sessions");
    await assert.rejects(prisma.$transaction(tx => lockTerminalForNewSession(tx, "missing-station")));
    const availabilityAudit = await prisma.auditEntry.findFirstOrThrow({ where: { terminalId: id, action: "TERMINAL_AVAILABILITY_CHANGED" } });
    assert.equal(availabilityAudit.actorId, staffIds[0]);
    assert.deepEqual(availabilityAudit.details, { before: "Available", after: "Unavailable" });
    await request(`/${id}/availability`, "PATCH", { status: "Unavailable" });
    assert.equal(await prisma.auditEntry.count({ where: { terminalId: id, action: "TERMINAL_AVAILABILITY_CHANGED" } }), 1);
    for (const body of [{}, { status: "Busy" }, { status: true }, { status: "Available", sessionId: null }]) assert.equal((await request(`/${id}/availability`, "PATCH", body)).status, 400);
    const listing = await request(`?search=${id}&status=Unavailable&page=1&limit=1`);
    const listBody = await listing.json();
    assert.equal(listing.status, 200);
    assert.equal(listBody.terminals[0].id, id);
    assert.deepEqual(listBody.pagination, { page: 1, limit: 1, total: 1, totalPages: 1 });
    for (const query of ["page=0", "limit=101", "status=Busy", "status=Available&status=Unavailable", "search[x]=y", "unknown=1"]) assert.equal((await request(`?${query}`)).status, 400);
    const missingActor = randomUUID();
    await assert.rejects(createTerminal({ id: terminalIds[2], name: "Rollback", location: "Lab" }, missingActor));
    assert.equal(await prisma.terminal.count({ where: { id: terminalIds[2] } }), 0);
    await assert.rejects(updateTerminal(id, { name: "Rollback" }, missingActor));
    assert.equal((await prisma.terminal.findUniqueOrThrow({ where: { id } })).name, "Updated Station");
    await assert.rejects(setTerminalAvailability(id, "Available", missingActor));
    assert.equal((await prisma.terminal.findUniqueOrThrow({ where: { id } })).status, "Unavailable");
    assert.equal((await request(`/${id}/availability`, "PATCH", { status: "Available" })).status, 200);
    assert.equal((await prisma.$transaction(tx => lockTerminalForNewSession(tx, id))).status, "Available");
    await assert.rejects(prisma.terminal.create({ data: { id: "UPPER-ID", name: "Invalid", location: "Lab" } }));
    assert.equal((await fetch(base + "/api/v1/auth/me", { headers: { "X-Terminal-ID": id } })).status, 401);
    assert.equal((await fetch(base + "/health")).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await prisma.auditEntry.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.terminal.deleteMany({ where: { id: { in: terminalIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await prisma.$disconnect();
  }
});
