import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { authConfig } from "../src/config/auth.js";
import { digest } from "../src/services/auth.service.js";
import { createDevelopmentInbox } from "../src/integrations/invitation-mail.js";
import { setLecturerStatus, updateLecturer } from "../src/services/lecturer.service.js";

test("lecturer invitation: mail acceptance, existing identity activation, single use, replacement and eligibility", async () => {
  const previous = { NODE_ENV: process.env.NODE_ENV, MAIL_TRANSPORT: process.env.MAIL_TRANSPORT, FRONTEND_BASE_URL: process.env.FRONTEND_BASE_URL, SMTP_HOST: process.env.SMTP_HOST, SMTP_PORT: process.env.SMTP_PORT, SMTP_USER: process.env.SMTP_USER, SMTP_PASSWORD: process.env.SMTP_PASSWORD, MAIL_FROM: process.env.MAIL_FROM };
  const unique = randomUUID(), staffIds: string[] = [], cookies: string[] = [];
  let courseId: number | undefined, sectionId: string | undefined;
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  process.env.NODE_ENV = "test"; process.env.MAIL_TRANSPORT = "disabled"; process.env.FRONTEND_BASE_URL = "http://localhost:5173";
  let inbox: ReturnType<typeof createDevelopmentInbox> | undefined;
  const headers = { Origin: authConfig.origins[0], "X-CSRF-Protection": "1", "Content-Type": "application/json" };
  let inboxUrl = "";
  let targetId = "", email = "";
  const send = (cookie = cookies[0], body?: unknown) => fetch(`${base}/admin/lecturers/${targetId}/invitation`, { method: "POST", headers: { ...headers, Cookie: cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const activate = (token: string, password = "FictionalPass123!") => fetch(`${base}/auth/lecturer-invitations/activate`, { method: "POST", headers, body: JSON.stringify({ token, password, passwordConfirmation: password }) });
  const coolDown = () => prisma.lecturerInvitation.updateMany({ where: { lecturerId: targetId }, data: { createdAt: new Date(Date.now() - 61000) } });
  async function mailToken() {
    const response = await fetch(inboxUrl);
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    const html = await response.text();
    const href = html.match(/href="([^"]*#token=[A-Za-z0-9_-]+)"/)?.[1]; assert.ok(href);
    const url = new URL(href); assert.equal(url.pathname, "/activate-lecturer"); assert.equal(url.origin, "http://localhost:5173");
    return new URLSearchParams(url.hash.slice(1)).get("token")!;
  }
  try {
    // Create the fictional lecturer and an assignment BEFORE enabling invitation
    // delivery. Activation must provision this exact pre-existing identity.
    for (let i = 0; i < 2; i++) {
      const staff = await prisma.staff.create({ data: { name: i ? "Existing fictional lecturer" : "Invitation administrator", email: `activation-${i}-${unique}@example.test`, role: i ? "LECTURER" : "ADMIN" } }); staffIds.push(staff.id);
      const token = randomBytes(32).toString("base64url"); cookies.push(`${authConfig.cookieName}=${token}`);
      await prisma.staffSession.create({ data: { staffId: staff.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 60000) } });
      if (i) { targetId = staff.id; email = staff.email; }
    }
    courseId = (await prisma.course.create({ data: { code: `ACTIVATE-${unique}`.toUpperCase(), title: "Existing assigned course" } })).id;
    sectionId = (await prisma.classSection.create({ data: { lecturerId: targetId, courseId, code: "A", academicYear: "2026/2027", term: "TEST", room: "Test", schedule: "Test" } })).id;
    assert.equal((await send("")).status, 401); assert.equal((await send(cookies[1])).status, 403);
    assert.equal((await send(cookies[0], { email: "attacker@example.test" })).status, 400);
    const unavailable = await send(); assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).invitation.deliveryStatus, "NOT_ATTEMPTED");
    assert.equal(await prisma.lecturerInvitation.count({ where: { lecturerId: targetId } }), 0);
    process.env.MAIL_TRANSPORT = "development-inbox";
    inbox = createDevelopmentInbox(); inbox.listen(0, "127.0.0.1"); await once(inbox, "listening"); const inboxAddress = inbox.address(); assert.ok(inboxAddress && typeof inboxAddress === "object"); inboxUrl = `http://127.0.0.1:${inboxAddress.port}/`;
    const sent = await send(); assert.equal(sent.status, 202); const sentBody = await sent.json();
    assert.equal(sentBody.invitation.deliveryStatus, "ACCEPTED");
    const firstToken = await mailToken(); assert.equal(JSON.stringify(sentBody).includes(firstToken), false);
    assert.equal((await send()).status, 429);
    assert.equal((await prisma.lecturerInvitation.findFirstOrThrow({ where: { lecturerId: targetId } })).tokenHash, digest(firstToken));
    await coolDown(); assert.equal((await send()).status, 202); const secondToken = await mailToken(); assert.notEqual(secondToken, firstToken);
    assert.equal((await activate(firstToken)).status, 400);
    await prisma.lecturerInvitation.updateMany({ where: { tokenHash: digest(secondToken) }, data: { expiresAt: new Date(Date.now() - 1) } });
    assert.equal((await activate(secondToken)).status, 400);
    await coolDown(); assert.equal((await send()).status, 202); const inactiveToken = await mailToken();
    await setLecturerStatus(targetId, "Inactive", staffIds[0]); assert.equal((await activate(inactiveToken)).status, 400);
    await setLecturerStatus(targetId, "Active", staffIds[0]); assert.equal((await activate(inactiveToken)).status, 400);
    await coolDown(); assert.equal((await send()).status, 202); const changedEmailToken = await mailToken();
    await updateLecturer(targetId, { email: `changed-${unique}@example.test` }, staffIds[0]); assert.equal((await activate(changedEmailToken)).status, 400);
    await updateLecturer(targetId, { email }, staffIds[0]);
    await coolDown();
    process.env.MAIL_TRANSPORT = "smtp"; process.env.SMTP_HOST = "127.0.0.1"; process.env.SMTP_PORT = "9";
    process.env.SMTP_USER = "fictional-test"; process.env.SMTP_PASSWORD = "fictional-test"; process.env.MAIL_FROM = "test@example.test";
    const failedDelivery = await send(); assert.equal(failedDelivery.status, 503);
    assert.equal((await failedDelivery.json()).invitation.deliveryStatus, "UNCONFIRMED");
    assert.equal((await prisma.lecturerInvitation.findFirstOrThrow({ where: { lecturerId: targetId }, orderBy: { createdAt: "desc" } })).delivery, "UNCONFIRMED");
    process.env.MAIL_TRANSPORT = "development-inbox";
    await coolDown(); assert.equal((await send()).status, 202); const validToken = await mailToken();
    const detailBefore = await (await fetch(`${base}/admin/lecturers/${targetId}`, { headers: { Cookie: cookies[0] } })).json();
    assert.equal(detailBefore.lecturer.accountSetup.status, "INVITATION_PENDING");
    assert.equal(JSON.stringify(detailBefore).includes(validToken), false); assert.ok(!("passwordHash" in detailBefore.lecturer));
    const concurrent = await Promise.all([activate(validToken), activate(validToken)]); assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 400]);
    assert.equal((await activate(validToken)).status, 400);
    const login = await fetch(`${base}/auth/session`, { method: "POST", headers, body: JSON.stringify({ email, password: "FictionalPass123!" }) }); assert.equal(login.status, 200);
    const user = (await login.json()).user; assert.equal(user.id, targetId); assert.equal(user.role, "LECTURER");
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const classes = await (await fetch(`${base}/lecturer/classes`, { headers: { Cookie: cookie } })).json(); assert.equal(classes.classes[0].id, sectionId);
    const overview = await fetch(`${base}/lecturer/overview`, { headers: { Cookie: cookie } }); assert.equal(overview.status, 200);
    assert.equal((await send()).status, 409); // provisioned accounts cannot be reinvited
    const detailAfter = await (await fetch(`${base}/admin/lecturers/${targetId}`, { headers: { Cookie: cookies[0] } })).json(); assert.equal(detailAfter.lecturer.accountSetup.status, "ACTIVATED");
    assert.equal(await prisma.auditEntry.count({ where: { lecturerId: targetId, action: "LECTURER_ACTIVATED", actorId: targetId } }), 1);
    const audits = await prisma.auditEntry.findMany({ where: { lecturerId: targetId, action: "LECTURER_INVITATION_ATTEMPTED" } });
    assert.ok(audits.every(event => event.actorId === staffIds[0])); assert.equal(JSON.stringify(audits).includes(validToken), false);
    assert.equal((await fetch(inboxUrl, { headers: { Origin: "https://untrusted.test" } })).status, 403);
    assert.equal((await fetch(base.replace("/api/v1", "/health"))).status, 200);
  } finally {
    if (inbox) await new Promise<void>(resolve => inbox!.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
    await prisma.auditEntry.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.lecturerInvitation.deleteMany({ where: { lecturerId: { in: staffIds } } });
    if (sectionId) await prisma.classSection.delete({ where: { id: sectionId } }); if (courseId) await prisma.course.delete({ where: { id: courseId } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } }); await prisma.$disconnect();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
