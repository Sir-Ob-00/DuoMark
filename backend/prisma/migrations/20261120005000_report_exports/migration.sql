-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'REPORT_EXPORT_REPORTED';

-- AlterTable
ALTER TABLE "AuditEntry" ADD COLUMN     "exportRequestId" TEXT,
ADD COLUMN     "reportId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AuditEntry_actorId_exportRequestId_key" ON "AuditEntry"("actorId", "exportRequestId");

-- Preserve all existing target/actor rules while adding the one supported
-- server-defined report action. Existing rows retain NULL report fields.
ALTER TABLE "AuditEntry" DROP CONSTRAINT "AuditEntry_target_matches_action";
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_target_matches_action" CHECK (
  num_nonnulls("studentId", "lecturerId", "courseId", "sectionId", "terminalId", "attendanceSessionId", "attendanceRecordId", "reportId") = 1 AND (
    ("studentId" IS NOT NULL AND "action"::text IN ('STUDENT_CREATED', 'STUDENT_UPDATED', 'STUDENT_CONSENT_RECORDED', 'BIOMETRIC_REQUESTED', 'BIOMETRIC_COMPLETED', 'BIOMETRIC_CANCELLED')) OR
    ("lecturerId" IS NOT NULL AND "action"::text IN ('LECTURER_CREATED', 'LECTURER_UPDATED', 'LECTURER_STATUS_CHANGED', 'LECTURER_INVITATION_ATTEMPTED')) OR
    ("courseId" IS NOT NULL AND "action"::text IN ('COURSE_CREATED', 'COURSE_UPDATED')) OR
    ("sectionId" IS NOT NULL AND "action"::text IN ('CLASS_SECTION_CREATED', 'CLASS_SECTION_UPDATED', 'ROSTER_STUDENT_ADDED', 'ROSTER_STUDENT_REMOVED')) OR
    ("terminalId" IS NOT NULL AND "action"::text IN ('TERMINAL_REGISTERED', 'TERMINAL_UPDATED', 'TERMINAL_AVAILABILITY_CHANGED')) OR
    ("attendanceSessionId" IS NOT NULL AND "action"::text IN ('SESSION_OPENED', 'SESSION_CLOSED')) OR
    ("attendanceRecordId" IS NOT NULL AND "action"::text = 'ATTENDANCE_RECORDED') OR
    ("reportId" IS NOT NULL AND "action"::text = 'REPORT_EXPORT_REPORTED')
  )
);
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_report_request" CHECK (
  ("action"::text = 'REPORT_EXPORT_REPORTED' AND "reportId" IS NOT NULL AND "reportId" = 'attendance' AND "exportRequestId" IS NOT NULL AND "exportRequestId" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') OR
  ("action"::text <> 'REPORT_EXPORT_REPORTED' AND "reportId" IS NULL AND "exportRequestId" IS NULL)
);

