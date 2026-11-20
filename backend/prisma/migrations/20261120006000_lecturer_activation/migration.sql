-- CreateEnum
CREATE TYPE "InvitationDelivery" AS ENUM ('PENDING', 'ACCEPTED', 'UNCONFIRMED');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'LECTURER_ACTIVATED';

-- CreateTable
CREATE TABLE "LecturerInvitation" (
    "id" TEXT NOT NULL,
    "lecturerId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "delivery" "InvitationDelivery" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "LecturerInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LecturerInvitation_tokenHash_key" ON "LecturerInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "LecturerInvitation_lecturerId_createdAt_idx" ON "LecturerInvitation"("lecturerId", "createdAt");

-- AddForeignKey
ALTER TABLE "LecturerInvitation" ADD CONSTRAINT "LecturerInvitation_lecturerId_fkey" FOREIGN KEY ("lecturerId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LecturerInvitation" ADD CONSTRAINT "LecturerInvitation_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "AuditEntry" DROP CONSTRAINT "AuditEntry_target_matches_action";
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_target_matches_action" CHECK (
  num_nonnulls("studentId", "lecturerId", "courseId", "sectionId", "terminalId", "attendanceSessionId", "attendanceRecordId", "reportId") = 1 AND (
    ("studentId" IS NOT NULL AND "action"::text IN ('STUDENT_CREATED', 'STUDENT_UPDATED', 'STUDENT_CONSENT_RECORDED', 'BIOMETRIC_REQUESTED', 'BIOMETRIC_COMPLETED', 'BIOMETRIC_CANCELLED')) OR
    ("lecturerId" IS NOT NULL AND "action"::text IN ('LECTURER_CREATED', 'LECTURER_UPDATED', 'LECTURER_STATUS_CHANGED', 'LECTURER_INVITATION_ATTEMPTED', 'LECTURER_ACTIVATED')) OR
    ("courseId" IS NOT NULL AND "action"::text IN ('COURSE_CREATED', 'COURSE_UPDATED')) OR
    ("sectionId" IS NOT NULL AND "action"::text IN ('CLASS_SECTION_CREATED', 'CLASS_SECTION_UPDATED', 'ROSTER_STUDENT_ADDED', 'ROSTER_STUDENT_REMOVED')) OR
    ("terminalId" IS NOT NULL AND "action"::text IN ('TERMINAL_REGISTERED', 'TERMINAL_UPDATED', 'TERMINAL_AVAILABILITY_CHANGED')) OR
    ("attendanceSessionId" IS NOT NULL AND "action"::text IN ('SESSION_OPENED', 'SESSION_CLOSED')) OR
    ("attendanceRecordId" IS NOT NULL AND "action"::text = 'ATTENDANCE_RECORDED') OR
    ("reportId" IS NOT NULL AND "action"::text = 'REPORT_EXPORT_REPORTED')
  )
);

ALTER TABLE "LecturerInvitation" ADD CONSTRAINT "LecturerInvitation_token_digest" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$');
