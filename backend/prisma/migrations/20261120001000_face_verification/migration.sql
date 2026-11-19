-- CreateEnum
CREATE TYPE "FakeFaceOutcome" AS ENUM ('MATCH', 'NO_MATCH');

-- CreateEnum
CREATE TYPE "FaceAttemptStatus" AS ENUM ('WAITING_FINGERPRINT', 'INVALIDATED', 'CONSUMED');

-- AlterTable
ALTER TABLE "ClassSection" ADD COLUMN     "isFictional" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "isFictional" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Terminal" ADD COLUMN     "isFictional" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DevelopmentCheckInDevice" (
    "id" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "credentialHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "faceChallengeId" TEXT,
    "fakeStudentId" TEXT,
    "fakeFaceOutcome" "FakeFaceOutcome" NOT NULL DEFAULT 'NO_MATCH',

    CONSTRAINT "DevelopmentCheckInDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaceVerificationAttempt" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "attendanceSessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "consentId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "developmentOnly" BOOLEAN NOT NULL DEFAULT true,
    "status" "FaceAttemptStatus" NOT NULL DEFAULT 'WAITING_FINGERPRINT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaceVerificationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DevelopmentCheckInDevice_credentialHash_key" ON "DevelopmentCheckInDevice"("credentialHash");

-- CreateIndex
CREATE INDEX "DevelopmentCheckInDevice_terminalId_idx" ON "DevelopmentCheckInDevice"("terminalId");

-- CreateIndex
CREATE UNIQUE INDEX "FaceVerificationAttempt_tokenHash_key" ON "FaceVerificationAttempt"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "FaceVerificationAttempt_challengeId_key" ON "FaceVerificationAttempt"("challengeId");

-- CreateIndex
CREATE INDEX "FaceVerificationAttempt_deviceId_status_idx" ON "FaceVerificationAttempt"("deviceId", "status");

-- CreateIndex
CREATE INDEX "FaceVerificationAttempt_attendanceSessionId_idx" ON "FaceVerificationAttempt"("attendanceSessionId");

-- CreateIndex
CREATE INDEX "FaceVerificationAttempt_expiresAt_idx" ON "FaceVerificationAttempt"("expiresAt");

-- AddForeignKey
ALTER TABLE "DevelopmentCheckInDevice" ADD CONSTRAINT "DevelopmentCheckInDevice_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevelopmentCheckInDevice" ADD CONSTRAINT "DevelopmentCheckInDevice_fakeStudentId_fkey" FOREIGN KEY ("fakeStudentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceVerificationAttempt" ADD CONSTRAINT "FaceVerificationAttempt_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "DevelopmentCheckInDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceVerificationAttempt" ADD CONSTRAINT "FaceVerificationAttempt_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceVerificationAttempt" ADD CONSTRAINT "FaceVerificationAttempt_attendanceSessionId_fkey" FOREIGN KEY ("attendanceSessionId") REFERENCES "AttendanceSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceVerificationAttempt" ADD CONSTRAINT "FaceVerificationAttempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceVerificationAttempt" ADD CONSTRAINT "FaceVerificationAttempt_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "StudentConsent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "FaceVerificationAttempt_one_pending_per_device" ON "FaceVerificationAttempt" ("deviceId") WHERE "status" = 'WAITING_FINGERPRINT';
ALTER TABLE "FaceVerificationAttempt" ADD CONSTRAINT "FaceVerificationAttempt_development_expiry" CHECK ("developmentOnly" = true AND "expiresAt" > "createdAt");