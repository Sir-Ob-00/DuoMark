-- Additive migration: Course and all existing data are untouched.
CREATE TYPE "StaffRole" AS ENUM ('ADMIN', 'LECTURER');
CREATE TABLE "Staff" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "StaffRole" NOT NULL DEFAULT 'LECTURER',
  CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Staff_email_key" ON "Staff"("email");
CREATE TABLE "StaffSession" (
  "tokenHash" TEXT NOT NULL,
  "staffId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StaffSession_pkey" PRIMARY KEY ("tokenHash"),
  CONSTRAINT "StaffSession_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "StaffSession_staffId_idx" ON "StaffSession"("staffId");
CREATE INDEX "StaffSession_expiresAt_idx" ON "StaffSession"("expiresAt");
CREATE TABLE "SignInLimit" (
  "key" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SignInLimit_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "SignInLimit_expiresAt_idx" ON "SignInLimit"("expiresAt");
