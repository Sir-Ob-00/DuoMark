import { prisma } from "../db/prisma.js";
try {
  const now = new Date();
  await prisma.staffSession.deleteMany({ where: { expiresAt: { lte: now } } });
  await prisma.signInLimit.deleteMany({ where: { expiresAt: { lte: now } } });
} catch {
  console.error("Auth cleanup failed.");
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
