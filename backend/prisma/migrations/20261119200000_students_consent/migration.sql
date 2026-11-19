-- CreateEnum
CREATE TYPE "EnrollmentState" AS ENUM ('Pending', 'Enrolled');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('STUDENT_CREATED', 'STUDENT_UPDATED', 'STUDENT_CONSENT_RECORDED');

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "program" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "classSectionId" TEXT NOT NULL,
    "faceEnrollment" "EnrollmentState" NOT NULL DEFAULT 'Pending',
    "fingerprintEnrollment" "EnrollmentState" NOT NULL DEFAULT 'Pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentConsent" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedById" TEXT NOT NULL,
    "consentVersion" TEXT,
    "consentReference" TEXT,

    CONSTRAINT "StudentConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEntry" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "details" JSONB NOT NULL,

    CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Student_studentId_key" ON "Student"("studentId");

-- CreateIndex
CREATE INDEX "Student_name_id_idx" ON "Student"("name", "id");

-- CreateIndex
CREATE INDEX "StudentConsent_studentId_recordedAt_id_idx" ON "StudentConsent"("studentId", "recordedAt", "id");

-- CreateIndex
CREATE INDEX "AuditEntry_studentId_timestamp_idx" ON "AuditEntry"("studentId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditEntry_actorId_timestamp_idx" ON "AuditEntry"("actorId", "timestamp");

-- AddForeignKey
ALTER TABLE "StudentConsent" ADD CONSTRAINT "StudentConsent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentConsent" ADD CONSTRAINT "StudentConsent_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Student" ADD CONSTRAINT "Student_studentId_canonical" CHECK ("studentId" = upper("studentId") AND "studentId" ~ '^[A-Z0-9][A-Z0-9/_-]{0,63}$');
