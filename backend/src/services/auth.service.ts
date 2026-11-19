import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { authConfig } from "../config/auth.js";
import { verifyPassword } from "./password.service.js";

export const publicStaff = { id: true, email: true, name: true, role: true } as const;
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export async function signIn(email: string, password: string, previousToken?: string) {
  const staff = await prisma.staff.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  const valid = await verifyPassword(password, staff?.passwordHash ?? undefined);
  if (!staff || !staff.passwordHash || !valid) return null;
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + authConfig.ttl * 1000);
  return prisma.$transaction(async tx => {
    // Serialize with deactivation. Recheck after expensive password verification.
    await tx.$queryRaw`SELECT "id" FROM "Staff" WHERE "id" = ${staff.id} FOR UPDATE`;
    const current = await tx.staff.findUnique({ where: { id: staff.id } });
    if (!current || current.status !== "Active" || current.passwordHash !== staff.passwordHash || current.email.toLowerCase() !== email.toLowerCase()) return null;
    if (previousToken) await tx.staffSession.deleteMany({ where: { tokenHash: digest(previousToken) } });
    await tx.staffSession.create({ data: { tokenHash: digest(token), staffId: staff.id, expiresAt } });
    return { token, expiresAt, user: { id: current.id, email: current.email, name: current.name, role: current.role } };
  });
}
export async function resolveSession(token: string) {
  const session = await prisma.staffSession.findUnique({ where: { tokenHash: digest(token) }, select: {
    expiresAt: true, staff: { select: { ...publicStaff, status: true } },
  } });
  if (!session || session.expiresAt.getTime() <= Date.now() || session.staff.status !== "Active") return null;
  const { status: _status, ...actor } = session.staff;
  return actor;
}
export async function signOut(token?: string) {
  if (token) await prisma.staffSession.deleteMany({ where: { tokenHash: digest(token) } });
}

// Atomic, shared across API processes; neither email nor IP is stored verbatim.
export async function consumeSignInLimit(key: string, maximum: number) {
  const rows = await prisma.$queryRaw<{ attempts: number; expiresAt: Date }[]>`
    INSERT INTO "SignInLimit" ("key", "attempts", "expiresAt")
    VALUES (${digest(key)}, 1, CURRENT_TIMESTAMP + INTERVAL '15 minutes')
    ON CONFLICT ("key") DO UPDATE SET
      "attempts" = CASE WHEN "SignInLimit"."expiresAt" <= CURRENT_TIMESTAMP THEN 1 ELSE "SignInLimit"."attempts" + 1 END,
      "expiresAt" = CASE WHEN "SignInLimit"."expiresAt" <= CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes' ELSE "SignInLimit"."expiresAt" END
    RETURNING "attempts", "expiresAt"`;
  return { allowed: rows[0].attempts <= maximum, retryAfter: Math.max(1, Math.ceil((rows[0].expiresAt.getTime() - Date.now()) / 1000)) };
}
