import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { authConfig } from "../src/config/auth.js";
import { digest } from "../src/services/auth.service.js";
import { setLecturerStatus } from "../src/services/lecturer.service.js";
import { requestLecturerInvitation } from "../src/services/invitation.service.js";
import { invitationAvailability } from "../src/config/invitations.js";

test("disabled invitations: admin authorization, truthful audit, retries and inactive rejection", async () => {
  const unique = randomUUID();
  const staffIds: string[] = [];
  const cookies: string[] = [];
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const request = (id: string, cookie = cookies[0], body?: unknown, query = "", headers: Record<string, string> = {}) => fetch(`${base}/api/v1/admin/lecturers/${id}/invitation${query}`, {
    method: "POST", headers: { Origin: authConfig.origins[0], "X-CSRF-Protection": "1", "Content-Type": "application/json", Cookie: cookie, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    for (let i = 0; i < 3; i++) {
      const staff = await prisma.staff.create({ data: { email: `invitation-${i}-${unique}@example.test`, name: "Invitation fixture", role: i === 0 ? "ADMIN" : "LECTURER", passwordHash: i === 2 ? "already-provisioned-placeholder" : null } });
      staffIds.push(staff.id);
      const token = randomBytes(32).toString("base64url");
      cookies.push(`${authConfig.cookieName}=${token}`);
      await prisma.staffSession.create({ data: { staffId: staff.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 60000) } });
    }
    const targetId = staffIds[1];
    assert.equal((await request(targetId, "")).status, 401);
    assert.equal((await request(targetId, cookies[1])).status, 403);
    assert.equal((await request(targetId, cookies[0], undefined, "", { "X-CSRF-Protection": "" })).status, 403);
    assert.equal((await request("invalid-id")).status, 400);
    assert.equal((await request(randomUUID())).status, 404);
    assert.equal((await request(staffIds[0])).status, 404); // never invite an admin through a lecturer route
    for (const body of [{ password: "forbidden" }, { token: "expired-or-reused-token" }, { expiresAt: "2000-01-01T00:00:00Z" }, { email: "other@example.test" }, { actorId: staffIds[1] }, null, []]) {
      assert.equal((await request(targetId, cookies[0], body)).status, 400);
    }
    assert.equal((await request(targetId, cookies[0], undefined, "?token=untrusted")).status, 400);
    assert.equal(await prisma.auditEntry.count({ where: { lecturerId: targetId } }), 0);
    const before = await prisma.staff.findUniqueOrThrow({ where: { id: targetId } });
    const sessionsBefore = await prisma.staffSession.count({ where: { staffId: targetId } });
    const unavailable = await request(targetId);
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get("cache-control"), "no-store");
    assert.deepEqual(await unavailable.json(), { error: invitationAvailability.message,
      invitation: { outcome: "UNAVAILABLE", deliveryStatus: "NOT_ATTEMPTED", provisioningStatus: "NOT_ATTEMPTED" } });
    const results = await Promise.all([request(targetId), request(targetId, cookies[0], {})]);
    assert.deepEqual(results.map(response => response.status), [503, 503]);
    const audit = await prisma.auditEntry.findMany({ where: { lecturerId: targetId, action: "LECTURER_INVITATION_ATTEMPTED" } });
    assert.equal(audit.length, 3);
    for (const entry of audit) {
      assert.equal(entry.actorId, staffIds[0]);
      assert.deepEqual(entry.details, { outcome: "UNAVAILABLE", deliveryStatus: "NOT_ATTEMPTED", provisioningStatus: "NOT_ATTEMPTED", missing: ["TRUSTED_PROVISIONING_FLOW", "INVITATION_DELIVERY_TRANSPORT"] });
    }
    assert.deepEqual(await prisma.staff.findUniqueOrThrow({ where: { id: targetId } }), before);
    assert.equal(await prisma.staffSession.count({ where: { staffId: targetId } }), sessionsBefore);
    const provisioned = await request(staffIds[2]);
    assert.equal(provisioned.status, 409);
    assert.equal((await provisioned.json()).invitation.outcome, "REJECTED_ALREADY_PROVISIONED");
    await setLecturerStatus(targetId, "Inactive", staffIds[0]);
    const inactive = await request(targetId);
    assert.equal(inactive.status, 409);
    assert.deepEqual(await inactive.json(), { error: "Inactive lecturers cannot be invited",
      invitation: { outcome: "REJECTED_INACTIVE", deliveryStatus: "NOT_ATTEMPTED", provisioningStatus: "NOT_ATTEMPTED" } });
    assert.equal((await fetch(`${base}/api/v1/auth/me`, { headers: { Cookie: cookies[1] } })).status, 401);
    await setLecturerStatus(targetId, "Active", staffIds[0]);
    assert.equal((await request(targetId)).status, 503); // activation cannot enable provisioning
    const count = await prisma.auditEntry.count({ where: { lecturerId: targetId } });
    await assert.rejects(requestLecturerInvitation(targetId, randomUUID()));
    assert.equal(await prisma.auditEntry.count({ where: { lecturerId: targetId } }), count);
    assert.equal((await prisma.staff.findUniqueOrThrow({ where: { id: targetId } })).passwordHash, null);
    assert.equal((await fetch(`${base}/health`)).status, 200);
    // No invitation issuance/redemption or delivery transport exists. Do not
    // fabricate expired/reused-token or transport-delivery verification here.
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await prisma.auditEntry.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await prisma.$disconnect();
  }
});
