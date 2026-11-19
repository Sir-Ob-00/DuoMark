import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { hashPassword } from "../src/services/password.service.js";
import { digest } from "../src/services/auth.service.js";
import { authConfig } from "../src/config/auth.js";
import { requireAuth, requireRole } from "../src/middleware/auth.js";

test("PostgreSQL staff authentication and security lifecycle", async () => {
  const unique = randomUUID();
  const email = `auth-test-${unique}@example.test`;
  const missingEmail = `missing-${unique}@example.test`;
  const password = randomBytes(24).toString("base64url");
  const ip = `test-${unique}`;
  const origin = authConfig.origins[0];
  // Isolated test process only: accept the unique rate-limit identity from loopback.
  app.set("trust proxy", "loopback");
  app.get(`/test-role-${unique}`, requireAuth, requireRole("ADMIN"), (_req, res) => res.sendStatus(204));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const courseCount = await prisma.course.count();
  let staffId: string | undefined;
  const request = (path: string, method = "GET", cookie?: string, body?: object, headers: Record<string, string> = {}) => fetch(base + path, {
    method, headers: { Origin: origin, "X-CSRF-Protection": "1", "X-Forwarded-For": ip, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sessionPath = "/api/v1/auth/session";
  const credentials = { email, password };
  const cookieFrom = (response: Response) => {
    const header = response.headers.get("set-cookie");
    assert.ok(Boolean(header?.includes("HttpOnly")));
    assert.ok(Boolean(header?.includes("SameSite=")));
    assert.equal(Boolean(header?.includes("Secure")), authConfig.cookie.secure);
    return header!.split(";")[0];
  };
  try {
    const staff = await prisma.staff.create({ data: { email, passwordHash: await hashPassword(password), name: "Auth Test", role: "ADMIN" } });
    staffId = staff.id;
    assert.equal((await request("/health")).status, 200);
    assert.equal((await request("/api/v1/auth/me")).status, 401);
    const wrong = await request(sessionPath, "POST", undefined, { email, password: "incorrect" });
    const absent = await request(sessionPath, "POST", undefined, { email: missingEmail, password });
    assert.equal(wrong.status, 401);
    assert.equal(absent.status, 401);
    assert.deepEqual(await wrong.json(), await absent.json());
    const csrf = await request(sessionPath, "POST", undefined, credentials, { "X-CSRF-Protection": "" });
    assert.equal(csrf.status, 403);
    assert.equal((await request(sessionPath, "POST", undefined, credentials, { Origin: "https://untrusted.example" })).status, 403);
    const login = await request(sessionPath, "POST", undefined, { ...credentials, email: email.toUpperCase() });
    assert.equal(login.status, 200);
    const cookie = cookieFrom(login);
    const body = await login.json();
    assert.deepEqual(body, { user: { id: staff.id, email, name: "Auth Test", role: "ADMIN" } });
    const restored = await request("/api/v1/auth/me", "GET", cookie);
    assert.equal(restored.status, 200);
    assert.deepEqual(await restored.json(), body);
    assert.equal((await request(`/test-role-${unique}`, "GET", cookie)).status, 204);
    const relogin = await request(sessionPath, "POST", cookie, credentials);
    assert.equal(relogin.status, 200);
    const rotated = cookieFrom(relogin);
    assert.ok(rotated !== cookie);
    assert.equal((await request("/api/v1/auth/me", "GET", cookie)).status, 401);
    await prisma.staff.update({ where: { id: staff.id }, data: { role: "LECTURER" } });
    const lecturer = await request("/api/v1/auth/me", "GET", rotated);
    assert.equal((await lecturer.json()).user.role, "LECTURER");
    assert.equal((await request(`/test-role-${unique}`, "GET", rotated)).status, 403);
    const logout = await request(sessionPath, "DELETE", rotated);
    assert.equal(logout.status, 204);
    assert.ok(Boolean(logout.headers.get("set-cookie")?.includes("Expires=Thu, 01 Jan 1970")));
    assert.equal((await request("/api/v1/auth/me", "GET", rotated)).status, 401);
    assert.equal(await prisma.staffSession.count({ where: { staffId: staff.id } }), 0);
    assert.equal((await request(sessionPath, "DELETE", rotated)).status, 204);
    const expiryLogin = await request(sessionPath, "POST", undefined, credentials);
    const expiryCookie = cookieFrom(expiryLogin);
    await prisma.staffSession.updateMany({ where: { staffId: staff.id }, data: { expiresAt: new Date(0) } });
    assert.equal((await request("/api/v1/auth/me", "GET", expiryCookie)).status, 401);
    assert.equal((await request("/api/v1/auth/me", "GET", `${authConfig.cookieName}=${randomBytes(32).toString("base64url")}`)).status, 401);
    let limited: Response | undefined;
    for (let i = 0; i < 11; i++) {
      limited = await request(sessionPath, "POST", undefined, { email, password: "incorrect" });
      if (limited.status === 429) break;
    }
    assert.equal(limited?.status, 429);
    assert.ok(Number(limited?.headers.get("retry-after")) > 0);
    assert.equal(await prisma.course.count(), courseCount);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (staffId) await prisma.staff.delete({ where: { id: staffId } });
    await prisma.signInLimit.deleteMany({ where: { key: { in: [digest(`ip:${ip}`), digest(`email:${email}`), digest(`email:${missingEmail}`)] } } });
    await prisma.$disconnect();
  }
});
