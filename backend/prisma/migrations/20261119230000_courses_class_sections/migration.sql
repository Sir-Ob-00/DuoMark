-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'COURSE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'COURSE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'CLASS_SECTION_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'CLASS_SECTION_UPDATED';

-- AlterTable
ALTER TABLE "AuditEntry" ADD COLUMN     "courseId" INTEGER,
ADD COLUMN     "sectionId" TEXT;

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "department" TEXT;

-- CreateTable
CREATE TABLE "ClassSection" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "courseId" INTEGER NOT NULL,
    "lecturerId" TEXT NOT NULL,
    "room" TEXT NOT NULL,
    "schedule" TEXT NOT NULL,
    "academicYear" TEXT NOT NULL,
    "term" TEXT NOT NULL,

    CONSTRAINT "ClassSection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClassSection_lecturerId_idx" ON "ClassSection"("lecturerId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassSection_courseId_academicYear_term_code_key" ON "ClassSection"("courseId", "academicYear", "term", "code");

-- CreateIndex
CREATE INDEX "AuditEntry_courseId_timestamp_idx" ON "AuditEntry"("courseId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditEntry_sectionId_timestamp_idx" ON "AuditEntry"("sectionId", "timestamp");

-- AddForeignKey
ALTER TABLE "ClassSection" ADD CONSTRAINT "ClassSection_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSection" ADD CONSTRAINT "ClassSection_lecturerId_fkey" FOREIGN KEY ("lecturerId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "ClassSection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve Course records/casing and add case/edge-space insensitive uniqueness.
CREATE UNIQUE INDEX "Course_code_normalized_key" ON "Course" (lower(btrim("code")));
ALTER TABLE "ClassSection" ADD CONSTRAINT "ClassSection_canonical_labels" CHECK (
  "code" = upper(btrim("code")) AND length("code") > 0 AND
  "term" = upper(btrim("term")) AND length("term") > 0
);
ALTER TABLE "AuditEntry" DROP CONSTRAINT "AuditEntry_target_matches_action";
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_target_matches_action" CHECK (
  num_nonnulls("studentId", "lecturerId", "courseId", "sectionId") = 1 AND (
    ("studentId" IS NOT NULL AND "action"::text IN ('STUDENT_CREATED', 'STUDENT_UPDATED', 'STUDENT_CONSENT_RECORDED', 'BIOMETRIC_REQUESTED', 'BIOMETRIC_COMPLETED', 'BIOMETRIC_CANCELLED')) OR
    ("lecturerId" IS NOT NULL AND "action"::text IN ('LECTURER_CREATED', 'LECTURER_UPDATED', 'LECTURER_STATUS_CHANGED')) OR
    ("courseId" IS NOT NULL AND "action"::text IN ('COURSE_CREATED', 'COURSE_UPDATED')) OR
    ("sectionId" IS NOT NULL AND "action"::text IN ('CLASS_SECTION_CREATED', 'CLASS_SECTION_UPDATED'))
  )
);