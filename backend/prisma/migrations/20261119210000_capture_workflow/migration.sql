-- CreateEnum
CREATE TYPE "BiometricModality" AS ENUM ('face', 'fingerprint');

-- CreateEnum
CREATE TYPE "CaptureOperation" AS ENUM ('ENROLL', 'REMOVE', 'RESET');

-- CreateEnum
CREATE TYPE "CaptureStatus" AS ENUM ('REQUESTED', 'COMPLETED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'BIOMETRIC_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'BIOMETRIC_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE 'BIOMETRIC_CANCELLED';

-- CreateTable
CREATE TABLE "CaptureAttempt" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "modality" "BiometricModality" NOT NULL,
    "operation" "CaptureOperation" NOT NULL,
    "status" "CaptureStatus" NOT NULL DEFAULT 'REQUESTED',
    "actorId" TEXT NOT NULL,
    "consentId" TEXT,
    "identityIndexNumber" TEXT,
    "serviceId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "confirmationEventId" TEXT,

    CONSTRAINT "CaptureAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CaptureAttempt_requestId_key" ON "CaptureAttempt"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "CaptureAttempt_confirmationEventId_key" ON "CaptureAttempt"("confirmationEventId");

-- CreateIndex
CREATE INDEX "CaptureAttempt_studentId_modality_requestedAt_idx" ON "CaptureAttempt"("studentId", "modality", "requestedAt");

-- AddForeignKey
ALTER TABLE "CaptureAttempt" ADD CONSTRAINT "CaptureAttempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureAttempt" ADD CONSTRAINT "CaptureAttempt_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureAttempt" ADD CONSTRAINT "CaptureAttempt_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "StudentConsent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "CaptureAttempt_one_active_modality" ON "CaptureAttempt" ("studentId", "modality") WHERE "status" = 'REQUESTED';
ALTER TABLE "CaptureAttempt" ADD CONSTRAINT "CaptureAttempt_enrollment_identity" CHECK ("operation" <> 'ENROLL' OR ("consentId" IS NOT NULL AND "identityIndexNumber" IS NOT NULL AND "expiresAt" IS NOT NULL));
