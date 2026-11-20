import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { authConfig } from "../src/config/auth.js";
import { digest, signIn } from "../src/services/auth.service.js";
import { hashPassword } from "../src/services/password.service.js";
import { createLecturer, updateLecturer, setLecturerStatus } from "../src/services/lecturer.service.js";

test("lecturer directory, provisioning separation, audits and durable session revocation", async () => {
  const unique = randomUUID();
  const staffIds: string[] = [];
  const targetEmail = `profile-directory-${unique}@example.test`;
  const password = randomBytes(24).toString("base64url");
  const adminToken = randomBytes(32).toString("base64url");
  const lecturerToken = randomBytes(32).toString("base64url");
  const adminCookie = `${authConfig.cookieName}=${adminToken}`;
  const lecturerCookie = `${authConfig.cookieName}=${lecturerToken}`;
  const ip = `lecturers-${unique}`;
  app.set("trust proxy", "loopback");
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const request = (path: string, method = "GET", body?: unknown, cookie = adminCookie) => fetch(base + path, {
    method, headers: { Origin: authConfig.origins[0], "X-CSRF-Protection": "1", Cookie: cookie, "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const root = "/api/v1/admin/lecturers";
  try {
    for (const [role, token] of [["ADMIN", adminToken], ["LECTURER", lecturerToken]] as const) {
      const staff = await prisma.staff.create({ data: { email: `${role}-directory-${unique}@example.test`, name: `${unique} ${role}`, role, passwordHash: role === "LECTURER" ? await hashPassword(password) : null } });
      staffIds.push(staff.id);
      await prisma.staffSession.create({ data: { tokenHash: digest(token), staffId: staff.id, expiresAt: new Date(Date.now() + 60000) } });
    }
    const adminId = staffIds[0];
    const fixtureLecturerId = staffIds[1];
    for (const [path, method] of [[root, "GET"], [root, "POST"], [`${root}/${fixtureLecturerId}`, "GET"], [`${root}/${fixtureLecturerId}`, "PATCH"], [`${root}/${fixtureLecturerId}/status`, "PATCH"]]) {
      const body = method === "GET" ? undefined : {};
      assert.equal((await request(path, method, body, lecturerCookie)).status, 403);
      assert.equal((await request(path, method, body, "")).status, 401);
    }
    const input = { name: `Directory ${unique}`, email: targetEmail.toUpperCase() };
    const created = await request(root, "POST", input);
    assert.equal(created.status, 201);
    const lecturer = (await created.json()).lecturer;
    staffIds.push(lecturer.id);
    assert.deepEqual(lecturer, { id: lecturer.id, name: input.name, email: targetEmail, role: "LECTURER", status: "Active" });
    assert.equal(created.headers.get("location"), `${root}/${lecturer.id}`);
    assert.equal((await prisma.staff.findUniqueOrThrow({ where: { id: lecturer.id } })).passwordHash, null);
    assert.equal((await request("/api/v1/auth/session", "POST", { email: targetEmail, password })).status, 401);
    assert.equal((await request(root, "POST", { ...input, email: targetEmail })).status, 409);
    assert.equal((await request(root, "POST", { ...input, email: `${"ADMIN"}-directory-${unique}@example.test` })).status, 409);
    // A direct database write cannot bypass case-insensitive uniqueness.
    await assert.rejects(prisma.staff.create({ data: { email: targetEmail.toUpperCase(), name: "Duplicate" } }));
    const detail = await request(`${root}/${lecturer.id}`);
    assert.equal(detail.status, 200);
    assert.deepEqual((await detail.json()).lecturer, { ...lecturer, assignedClasses: [], accountSetup: {
      status: "AWAITING_SETUP", lastInvitationAt: null, expiresAt: null, deliveryStatus: null, canInvite: true,
    } });
    for (const bad of [{ name: "" }, { email: "invalid" }, { role: "ADMIN" }, { password: "forbidden" }, { passwordHash: "forbidden" }, { status: "Inactive" }, {}, null, []]) {
      assert.equal((await request(`${root}/${lecturer.id}`, "PATCH", bad)).status, 400);
    }
    assert.equal((await request(root, "POST", { ...input, password: "forbidden" })).status, 400);
    assert.equal((await request(`${root}/${adminId}`)).status, 404);
    assert.equal((await request(`${root}/${adminId}`, "PATCH", { name: "Cannot edit admin" })).status, 404);
    assert.equal((await request(`${root}/${adminId}/status`, "PATCH", { status: "Inactive" })).status, 404);
    assert.equal((await request(`${root}/not-a-uuid`)).status, 400);
    assert.equal((await request(`${root}/${randomUUID()}`)).status, 404);
    assert.equal((await request(`${root}/${lecturer.id}`, "PATCH", { email: `${"LECTURER"}-directory-${unique}@example.test` })).status, 409);
    const patch = await request(`${root}/${lecturer.id}`, "PATCH", { name: `Updated ${unique}` });
    assert.equal(patch.status, 200);
    const editAudit = await prisma.auditEntry.findFirstOrThrow({ where: { lecturerId: lecturer.id, action: "LECTURER_UPDATED" } });
    assert.equal(editAudit.actorId, adminId);
    assert.deepEqual(editAudit.details, { changedFields: ["name"], before: { name: input.name }, after: { name: `Updated ${unique}` } });
    assert.equal((await request(`${root}/${lecturer.id}/status`, "PATCH", { status: "Inactive" })).status, 200);
    const list = await request(`${root}?search=${targetEmail.toUpperCase()}&status=Inactive&page=1&limit=1`);
    const listing = await list.json();
    assert.equal(list.status, 200);
    assert.equal(listing.lecturers[0].id, lecturer.id);
    assert.deepEqual(listing.pagination, { page: 1, limit: 1, total: 1, totalPages: 1 });
    assert.equal((await (await request(`${root}?search=${targetEmail}&status=Active`)).json()).pagination.total, 0);
    const byName = await (await request(`${root}?search=${encodeURIComponent(`updated ${unique}`)}`)).json();
    assert.equal(byName.lecturers[0].id, lecturer.id);
    const allMatching = await (await request(`${root}?search=${unique}`)).json();
    assert.equal(allMatching.lecturers.some((row: { role: string }) => row.role === "ADMIN"), false);
    assert.equal((await (await request(`${root}?search=${targetEmail}&page=2&limit=1`)).json()).lecturers.length, 0);
    for (const query of ["limit=101", "page=0", "status=Disabled", "status=Active&status=Inactive", "search[x]=y", "unknown=1"]) {
      assert.equal((await request(`${root}?${query}`)).status, 400);
    }
    for (const body of [{ status: "Disabled" }, { status: "Active", role: "ADMIN" }, {}]) {
      assert.equal((await request(`${root}/${lecturer.id}/status`, "PATCH", body)).status, 400);
    }
    // Audit insert failure rolls back both profile writes and session revocation.
    const missingActor = randomUUID();
    await assert.rejects(createLecturer({ name: "Rollback", email: `rollback-${unique}@example.test` }, missingActor));
    assert.equal(await prisma.staff.count({ where: { email: `rollback-${unique}@example.test` } }), 0);
    await assert.rejects(updateLecturer(lecturer.id, { name: "Rollback" }, missingActor));
    assert.equal((await prisma.staff.findUniqueOrThrow({ where: { id: lecturer.id } })).name, `Updated ${unique}`);
    await assert.rejects(setLecturerStatus(fixtureLecturerId, "Inactive", missingActor));
    assert.equal((await request("/api/v1/auth/me", "GET", undefined, lecturerCookie)).status, 200);
    const login = await request("/api/v1/auth/session", "POST", { email: `${"LECTURER"}-directory-${unique}@example.test`, password }, "");
    assert.equal(login.status, 200);
    const loginCookie = login.headers.get("set-cookie")!.split(";")[0];
    const deactivate = await request(`${root}/${fixtureLecturerId}/status`, "PATCH", { status: "Inactive" });
    assert.equal(deactivate.status, 200);
    assert.equal(await prisma.staffSession.count({ where: { staffId: fixtureLecturerId } }), 0);
    assert.equal((await request("/api/v1/auth/me", "GET", undefined, lecturerCookie)).status, 401);
    assert.equal((await request("/api/v1/auth/me", "GET", undefined, loginCookie)).status, 401);
    const deniedLogin = await request("/api/v1/auth/session", "POST", { email: `${"LECTURER"}-directory-${unique}@example.test`, password });
    assert.equal(deniedLogin.status, 401);
    assert.deepEqual(await deniedLogin.json(), { error: "Invalid email or password" });
    assert.equal((await request(`${root}/${fixtureLecturerId}/status`, "PATCH", { status: "Active" })).status, 200);
    assert.equal((await request("/api/v1/auth/me", "GET", undefined, loginCookie)).status, 401); // no session resurrection
    const reactivated = await signIn(`lecturer-directory-${unique}@example.test`, password);
    assert.ok(Boolean(reactivated));
    await Promise.all([signIn(`lecturer-directory-${unique}@example.test`, password), setLecturerStatus(fixtureLecturerId, "Inactive", adminId)]);
    assert.equal(await prisma.staffSession.count({ where: { staffId: fixtureLecturerId } }), 0);
    const statusAudit = await prisma.auditEntry.findFirstOrThrow({ where: { lecturerId: fixtureLecturerId, action: "LECTURER_STATUS_CHANGED", details: { path: ["before"], equals: "Active" } } });
    assert.equal(statusAudit.actorId, adminId);
    assert.equal(statusAudit.studentId, null);
    assert.equal((await request("/health")).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await prisma.auditEntry.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await prisma.signInLimit.deleteMany({ where: { key: { in: [digest(`ip:${ip}`), digest(`email:${targetEmail}`), digest(`email:lecturer-directory-${unique}@example.test`)] } } });
    await prisma.$disconnect();
  }
});
