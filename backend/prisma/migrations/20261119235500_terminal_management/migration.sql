-- CreateEnum
CREATE TYPE "TerminalAvailability" AS ENUM ('Available', 'Unavailable');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'TERMINAL_REGISTERED';
ALTER TYPE "AuditAction" ADD VALUE 'TERMINAL_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'TERMINAL_AVAILABILITY_CHANGED';

-- AlterTable
ALTER TABLE "AuditEntry" ADD COLUMN     "terminalId" TEXT;

-- CreateTable
CREATE TABLE "Terminal" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "status" "TerminalAvailability" NOT NULL DEFAULT 'Available',

    CONSTRAINT "Terminal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditEntry_terminalId_timestamp_idx" ON "AuditEntry"("terminalId", "timestamp");

-- AddForeignKey
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_public_id_format" CHECK (
  length("id") BETWEEN 2 AND 40 AND "id" ~ '^[a-z0-9]([a-z0-9]|-[a-z0-9])*$'
);
ALTER TABLE "AuditEntry" DROP CONSTRAINT "AuditEntry_target_matches_action";
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_target_matches_action" CHECK (
  num_nonnulls("studentId", "lecturerId", "courseId", "sectionId", "terminalId") = 1 AND (
    ("studentId" IS NOT NULL AND "action"::text IN ('STUDENT_CREATED', 'STUDENT_UPDATED', 'STUDENT_CONSENT_RECORDED', 'BIOMETRIC_REQUESTED', 'BIOMETRIC_COMPLETED', 'BIOMETRIC_CANCELLED')) OR
    ("lecturerId" IS NOT NULL AND "action"::text IN ('LECTURER_CREATED', 'LECTURER_UPDATED', 'LECTURER_STATUS_CHANGED', 'LECTURER_INVITATION_ATTEMPTED')) OR
    ("courseId" IS NOT NULL AND "action"::text IN ('COURSE_CREATED', 'COURSE_UPDATED')) OR
    ("sectionId" IS NOT NULL AND "action"::text IN ('CLASS_SECTION_CREATED', 'CLASS_SECTION_UPDATED', 'ROSTER_STUDENT_ADDED', 'ROSTER_STUDENT_REMOVED')) OR
    ("terminalId" IS NOT NULL AND "action"::text IN ('TERMINAL_REGISTERED', 'TERMINAL_UPDATED', 'TERMINAL_AVAILABILITY_CHANGED'))
  )
);