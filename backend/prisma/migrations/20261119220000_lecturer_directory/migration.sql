-- CreateEnum
CREATE TYPE "StaffStatus" AS ENUM ('Active', 'Inactive');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'LECTURER_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'LECTURER_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'LECTURER_STATUS_CHANGED';

-- AlterTable
ALTER TABLE "AuditEntry" ADD COLUMN     "lecturerId" TEXT,
ALTER COLUMN "studentId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "status" "StaffStatus" NOT NULL DEFAULT 'Active',
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "AuditEntry_lecturerId_timestamp_idx" ON "AuditEntry"("lecturerId", "timestamp");

-- AddForeignKey
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_lecturerId_fkey" FOREIGN KEY ("lecturerId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Staff_email_case_insensitive_key" ON "Staff" (lower("email"));
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_target_matches_action" CHECK (
  ("lecturerId" IS NOT NULL AND "studentId" IS NULL AND "action"::text LIKE 'LECTURER_%') OR
  ("lecturerId" IS NULL AND "studentId" IS NOT NULL AND "action"::text NOT LIKE 'LECTURER_%')
);