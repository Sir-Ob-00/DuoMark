import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { hashPassword } from "../services/password.service.js";

try {
  if (process.env.NODE_ENV !== "development") throw new Error("Requires NODE_ENV=development.");
  const email = process.env.DEV_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.DEV_ADMIN_PASSWORD;
  delete process.env.DEV_ADMIN_PASSWORD;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !password || password.length < 12 || Buffer.byteLength(password) > 1024) {
    throw new Error("Set DEV_ADMIN_EMAIL and DEV_ADMIN_PASSWORD (12+ characters, at most 1024 bytes).");
  }
  await prisma.staff.create({ data: { email, name: process.env.DEV_ADMIN_NAME ?? "Development Admin", role: "ADMIN", passwordHash: await hashPassword(password) } });
  console.log("Development admin created.");
} catch {
  console.error("Admin creation failed. Requires development mode, valid environment inputs, a unique email, and migrated database.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
