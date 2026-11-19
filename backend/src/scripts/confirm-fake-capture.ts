import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { confirmDevelopmentAttempt } from "../integrations/development-fake.js";
import { HttpError } from "../utils/http-error.js";
try {
  const id = process.argv[2];
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "Supply an attempt UUID");
  console.log(JSON.stringify({ developmentOnly: true, attempt: await confirmDevelopmentAttempt(id) }));
} catch (error) {
  console.error(error instanceof HttpError ? error.message : "Fake confirmation failed");
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
