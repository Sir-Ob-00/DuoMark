-- CreateEnum
CREATE TYPE "AttendanceSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'SESSION_OPENED';
ALTER TYPE "AuditAction" ADD VALUE 'SESSION_CLOSED';

-- AlterTable
ALTER TABLE "AuditEntry" ADD COLUMN     "attendanceSessionId" TEXT;

-- CreateTable
CREATE TABLE "AttendanceSession" (
    "id" TEXT NOT NULL,
    "lecturerId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "courseId" INTEGER NOT NULL,
    "courseCode" TEXT NOT NULL,
    "courseName" TEXT NOT NULL,
    "sectionCode" TEXT NOT NULL,
    "room" TEXT NOT NULL,
    "academicYear" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "status" "AttendanceSessionStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "AttendanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceSession_lecturerId_openedAt_id_idx" ON "AttendanceSession"("lecturerId", "openedAt", "id");

-- CreateIndex
CREATE INDEX "AttendanceSession_sectionId_lecturerId_openedAt_idx" ON "AttendanceSession"("sectionId", "lecturerId", "openedAt");

-- CreateIndex
CREATE INDEX "AttendanceSession_terminalId_status_idx" ON "AttendanceSession"("terminalId", "status");

-- CreateIndex
CREATE INDEX "AuditEntry_attendanceSessionId_timestamp_idx" ON "AuditEntry"("attendanceSessionId", "timestamp");

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_lecturerId_fkey" FOREIGN KEY ("lecturerId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "ClassSection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_attendanceSessionId_fkey" FOREIGN KEY ("attendanceSessionId") REFERENCES "AttendanceSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "AttendanceSession_one_open_per_terminal" ON "AttendanceSession" ("terminalId") WHERE "status" = 'OPEN';
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_lifecycle_timestamps" CHECK (
  ("status" = 'OPEN' AND "closedAt" IS NULL) OR
  ("status" = 'CLOSED' AND "closedAt" IS NOT NULL AND "closedAt" >= "openedAt")
);
ALTER TABLE "AuditEntry" DROP CONSTRAINT "AuditEntry_target_matches_action";
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_target_matches_action" CHECK (
  num_nonnulls("studentId", "lecturerId", "courseId", "sectionId", "terminalId", "attendanceSessionId") = 1 AND (
    ("studentId" IS NOT NULL AND "action"::text IN ('STUDENT_CREATED', 'STUDENT_UPDATED', 'STUDENT_CONSENT_RECORDED', 'BIOMETRIC_REQUESTED', 'BIOMETRIC_COMPLETED', 'BIOMETRIC_CANCELLED')) OR
    ("lecturerId" IS NOT NULL AND "action"::text IN ('LECTURER_CREATED', 'LECTURER_UPDATED', 'LECTURER_STATUS_CHANGED', 'LECTURER_INVITATION_ATTEMPTED')) OR
    ("courseId" IS NOT NULL AND "action"::text IN ('COURSE_CREATED', 'COURSE_UPDATED')) OR
    ("sectionId" IS NOT NULL AND "action"::text IN ('CLASS_SECTION_CREATED', 'CLASS_SECTION_UPDATED', 'ROSTER_STUDENT_ADDED', 'ROSTER_STUDENT_REMOVED')) OR
    ("terminalId" IS NOT NULL AND "action"::text IN ('TERMINAL_REGISTERED', 'TERMINAL_UPDATED', 'TERMINAL_AVAILABILITY_CHANGED')) OR
    ("attendanceSessionId" IS NOT NULL AND "action"::text IN ('SESSION_OPENED', 'SESSION_CLOSED'))
  )
);