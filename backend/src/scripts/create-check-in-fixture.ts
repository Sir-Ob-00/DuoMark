import "dotenv/config";
import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { digest } from "../services/auth.service.js";
import { requireCheckInIntegration } from "../integrations/check-in.js";

try {
  requireCheckInIntegration();
  const token = process.env.DEV_CHECK_IN_TOKEN;
  delete process.env.DEV_CHECK_IN_TOKEN;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Missing development credential");
  const suffix = randomUUID();
  const stationId = `f-${suffix}`;
  await prisma.$transaction(async tx => {
    const admin = await tx.staff.create({ data: { name: "Fictional consent verifier", email: `fictional-admin-${suffix}@example.test`, role: "ADMIN" } });
    const lecturer = await tx.staff.create({ data: { name: "Fictional lecturer", email: `fictional-lecturer-${suffix}@example.test`, role: "LECTURER" } });
    const course = await tx.course.create({ data: { code: `FAKE-${suffix}`.toUpperCase(), title: "Fictional Check-in Course" } });
    const section = await tx.classSection.create({ data: { code: "FICTIONAL A", courseId: course.id, lecturerId: lecturer.id,
      room: "Fictional lab", schedule: "Test only", academicYear: "2026/2027", term: "TEST", isFictional: true } });
    await tx.terminal.create({ data: { id: stationId, name: "Fictional device station", location: "Local test only", isFictional: true } });
    const student = await tx.student.create({ data: { studentId: `FAKE-${suffix}`.toUpperCase(), name: "Fictional student",
      program: "Test", department: "Test", level: "100", classSectionId: section.id, isFictional: true, faceEnrollment: "Enrolled", fingerprintEnrollment: "Enrolled" } });
    await tx.sectionRosterMembership.create({ data: { sectionId: section.id, studentId: student.id } });
    await tx.studentConsent.create({ data: { studentId: student.id, verifiedById: admin.id, consentReference: "Fictional test consent only" } });
    const session = await tx.attendanceSession.create({ data: { lecturerId: lecturer.id, sectionId: section.id, terminalId: stationId,
      courseId: course.id, courseCode: course.code, courseName: course.title, sectionCode: section.code, room: section.room,
      academicYear: section.academicYear, term: section.term } });
    await tx.auditEntry.create({ data: { actorId: lecturer.id, attendanceSessionId: session.id, action: "SESSION_OPENED", details: { developmentOnly: true, fictionalFixture: true } } });
    await tx.developmentCheckInDevice.create({ data: { terminalId: stationId, credentialHash: digest(token), fakeStudentId: student.id, fakeFaceOutcome: "MATCH", fakeFingerprintOutcome: "MATCH" } });
  });
  // The credential is never printed. No passwords or staff sessions are created.
  console.log(`Fictional fixture created. Terminal ID: ${stationId}`);
} catch {
  console.error("Fixture creation failed. Requires development/test fake mode, a unique 43-character DEV_CHECK_IN_TOKEN, and a migrated database.");
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
