-- CreateEnum
CREATE TYPE "CheckInCompletionOutcome" AS ENUM ('RECORDED', 'ALREADY_RECORDED');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'ATTENDANCE_RECORDED';

-- AlterTable
ALTER TABLE "AuditEntry" ADD COLUMN     "attendanceRecordId" TEXT,
ADD COLUMN     "deviceActorId" TEXT,
ALTER COLUMN "actorId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "DevelopmentCheckInDevice" ADD COLUMN     "fakeFingerprintOutcome" "FakeFaceOutcome" NOT NULL DEFAULT 'NO_MATCH';

-- AlterTable
ALTER TABLE "FaceVerificationAttempt" ADD COLUMN     "attendanceRecordId" TEXT,
ADD COLUMN     "completionOutcome" "CheckInCompletionOutcome",
ADD COLUMN     "finalizedAt" TIMESTAMP(3),
ADD COLUMN     "fingerprintChallengeId" TEXT,
ADD COLUMN     "fingerprintServiceId" TEXT;

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "studentIndexNumber" TEXT NOT NULL,
    "studentName" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "developmentOnly" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceRecord_sessionId_recordedAt_id_idx" ON "AttendanceRecord"("sessionId", "recordedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_sessionId_studentId_key" ON "AttendanceRecord"("sessionId", "studentId");

-- CreateIndex
CREATE INDEX "AuditEntry_deviceActorId_timestamp_idx" ON "AuditEntry"("deviceActorId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditEntry_attendanceRecordId_idx" ON "AuditEntry"("attendanceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "FaceVerificationAttempt_fingerprintChallengeId_key" ON "FaceVerificationAttempt"("fingerprintChallengeId");

-- AddForeignKey
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_deviceActorId_fkey" FOREIGN KEY ("deviceActorId") REFERENCES "DevelopmentCheckInDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_attendanceRecordId_fkey" FOREIGN KEY ("attendanceRecordId") REFERENCES "AttendanceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceVerificationAttempt" ADD CONSTRAINT "FaceVerificationAttempt_attendanceRecordId_fkey" FOREIGN KEY ("attendanceRecordId") REFERENCES "AttendanceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AttendanceSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "DevelopmentCheckInDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_development_only" CHECK ("developmentOnly" = true);
ALTER TABLE "FaceVerificationAttempt" ADD CONSTRAINT "FaceVerificationAttempt_consumed_receipt" CHECK (
  "status" <> 'CONSUMED' OR ("attendanceRecordId" IS NOT NULL AND "completionOutcome" IS NOT NULL AND "fingerprintServiceId" IS NOT NULL AND "fingerprintChallengeId" IS NOT NULL AND "finalizedAt" IS NOT NULL)
);
ALTER TABLE "AuditEntry" DROP CONSTRAINT "AuditEntry_target_matches_action";
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_actor_matches_action" CHECK (
  ("action"::text = 'ATTENDANCE_RECORDED' AND "actorId" IS NULL AND "deviceActorId" IS NOT NULL) OR
  ("action"::text <> 'ATTENDANCE_RECORDED' AND "actorId" IS NOT NULL AND "deviceActorId" IS NULL)
);
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_target_matches_action" CHECK (
  num_nonnulls("studentId", "lecturerId", "courseId", "sectionId", "terminalId", "attendanceSessionId", "attendanceRecordId") = 1 AND (
    ("studentId" IS NOT NULL AND "action"::text IN ('STUDENT_CREATED', 'STUDENT_UPDATED', 'STUDENT_CONSENT_RECORDED', 'BIOMETRIC_REQUESTED', 'BIOMETRIC_COMPLETED', 'BIOMETRIC_CANCELLED')) OR
    ("lecturerId" IS NOT NULL AND "action"::text IN ('LECTURER_CREATED', 'LECTURER_UPDATED', 'LECTURER_STATUS_CHANGED', 'LECTURER_INVITATION_ATTEMPTED')) OR
    ("courseId" IS NOT NULL AND "action"::text IN ('COURSE_CREATED', 'COURSE_UPDATED')) OR
    ("sectionId" IS NOT NULL AND "action"::text IN ('CLASS_SECTION_CREATED', 'CLASS_SECTION_UPDATED', 'ROSTER_STUDENT_ADDED', 'ROSTER_STUDENT_REMOVED')) OR
    ("terminalId" IS NOT NULL AND "action"::text IN ('TERMINAL_REGISTERED', 'TERMINAL_UPDATED', 'TERMINAL_AVAILABILITY_CHANGED')) OR
    ("attendanceSessionId" IS NOT NULL AND "action"::text IN ('SESSION_OPENED', 'SESSION_CLOSED')) OR
    ("attendanceRecordId" IS NOT NULL AND "action"::text = 'ATTENDANCE_RECORDED')
  )
);