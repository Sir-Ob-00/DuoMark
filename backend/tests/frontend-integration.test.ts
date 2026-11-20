import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { hashPassword } from "../src/services/password.service.js";
import { digest } from "../src/services/auth.service.js";
import { authConfig } from "../src/config/auth.js";
import { createLiveApi } from "../../frontend/src/api/live-adapter.js";
import type { StaffUser, SignInCredentials } from "../../frontend/src/api/types.js";

test("real frontend adapters: staff restore, admin writes, lecturer roster/session, fake device register and isolation", async () => {
  const unique = randomUUID();
  const staffIds: string[] = [], studentIds: string[] = [], courseIds: number[] = [];
  let sectionId: string | undefined, deviceId: string | undefined;
  const terminalId = `i-${unique}`, password = randomBytes(24).toString("base64url");
  const oldMode = process.env.CHECK_IN_MODE, oldEnvironment = process.env.NODE_ENV, oldCapture = process.env.BIOMETRIC_CAPTURE_MODE;
  process.env.CHECK_IN_MODE = "development-fake"; process.env.NODE_ENV = "test";
  process.env.BIOMETRIC_CAPTURE_MODE = "disabled";
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  function browser() {
    let cookie = "";
    const paths: string[] = [];
    async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
      paths.push(path);
      const headers = new Headers(options.headers);
      headers.set("Origin", authConfig.origins[0]); if (cookie) headers.set("Cookie", cookie);
      const response = await fetch(base + path, { ...options, headers });
      if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie")!.split(";")[0];
      const body = response.status === 204 ? undefined : await response.json();
      if (!response.ok) throw new Error(`${response.status}: ${body.error}`);
      return body as T;
    }
    const publicUser = (user: { id: string; email: string; name: string; role: string }): StaffUser => ({ ...user, role: user.role === "ADMIN" ? "admin" : "lecturer" });
    async function currentUser() { try { return publicUser((await request<{ user: Parameters<typeof publicUser>[0] }>("/auth/me")).user); } catch (error) { if (String(error).includes("401:")) return null; throw error; } }
    async function signIn(credentials: SignInCredentials) { return publicUser((await request<{ user: Parameters<typeof publicUser>[0] }>("/auth/session", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Protection": "1" }, body: JSON.stringify(credentials) })).user); }
    const api = createLiveApi({ request, currentUser, signIn, signOut: () => request<void>("/auth/session", { method: "DELETE", headers: { "X-CSRF-Protection": "1" } }) });
    return { api, request, paths };
  }
  try {
    const passwordHash = await hashPassword(password);
    const admin = await prisma.staff.create({ data: { email: `integration-admin-${unique}@example.test`, name: "Fictional integration admin", role: "ADMIN", passwordHash } }); staffIds.push(admin.id);
    const adminBrowser = browser(), lecturerBrowser = browser(), secondBrowser = browser();
    assert.equal((await adminBrowser.api.signIn({ email: admin.email, password })).role, "admin");
    assert.equal((await adminBrowser.api.getCurrentUser())?.id, admin.id); // app restore uses same server cookie
    const staff = [];
    for (let i = 0; i < 2; i++) {
      const lecturer = await adminBrowser.api.saveStaff({ name: `Fictional lecturer ${i}`, email: `integration-lecturer-${i}-${unique}@example.test`, role: "lecturer" }); staff.push(lecturer); staffIds.push(lecturer.id);
      assert.equal((await prisma.staff.findUniqueOrThrow({ where: { id: lecturer.id } })).passwordHash, null);
      // Fictional development provisioning fixture, never a browser/API shortcut.
      await prisma.staff.update({ where: { id: lecturer.id }, data: { passwordHash } });
    }
    await lecturerBrowser.api.signIn({ email: staff[0].email, password }); await secondBrowser.api.signIn({ email: staff[1].email, password });
    const courseInput = { code: `INTEGRATION-${unique}`, name: "Fictional integration course", department: "Test" };
    const [course, duplicateSubmission] = await Promise.all([adminBrowser.api.saveCourse(courseInput), adminBrowser.api.saveCourse(courseInput)]);
    assert.equal(course.id, duplicateSubmission.id); // coalesced pending form submission
    courseIds.push(Number(course.id));
    const section = await adminBrowser.api.saveSection({ code: "A", courseId: course.id, lecturerId: staff[0].id, room: "Test room", schedule: "Test", academicYear: "2026/2027", term: "TEST", studentIds: [] }); sectionId = section.id;
    const student = await adminBrowser.api.saveStudent({ studentId: `INTEGRATION-${unique}`, name: "Fictional integration student", program: "Test", department: "Test", level: "100", classSectionId: section.id }); studentIds.push(student.id);
    assert.ok((await adminBrowser.api.recordEnrollmentConsent(student.id)).consentRecorded);
    assert.equal((await adminBrowser.api.getEnrollmentRecord(student.id)).face, "Pending");
    await assert.rejects(adminBrowser.request(`/admin/students/${student.id}/enrollment/face`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Protection": "1" }, body: JSON.stringify({ requestId: randomUUID(), deviceId: "development-fake-device", identityVerified: true, studentIndexNumber: student.studentId }) }), /503/);
    await adminBrowser.api.updateSectionRoster(section.id, student.id, "add");
    await assert.rejects(adminBrowser.api.updateSectionRoster(section.id, student.id, "add"), /409/);
    const classes = await lecturerBrowser.api.getLecturerClasses();
    assert.equal(classes.find(row => row.id === section.id)?.students[0].id, student.id);
    assert.deepEqual(Object.keys(classes.find(row => row.id === section.id)!.students[0]).sort(), ["id", "name", "studentId"]);
    await adminBrowser.api.saveTerminal({ id: terminalId, name: "Fictional integration kiosk", location: "Test" });
    const display = async () => (await fetch(`${base}/terminals/${terminalId}/session`)).json();
    assert.equal((await display()).activeSession, null);
    const opened = await lecturerBrowser.api.openLecturerSession(section.id, terminalId);
    assert.equal((await display()).activeSession.id, opened.id);
    assert.equal(opened.status, "Open"); assert.match(opened.startsAt, /^\d{2}:\d{2}:\d{2}$/);
    await assert.rejects(secondBrowser.api.getLecturerSessionDetail(opened.id), /404/);
    assert.equal((await secondBrowser.api.getLecturerSessions()).some(row => row.id === opened.id), false);
    await prisma.classSection.update({ where: { id: section.id }, data: { isFictional: true } });
    await prisma.terminal.update({ where: { id: terminalId }, data: { isFictional: true } });
    await prisma.student.update({ where: { id: student.id }, data: { isFictional: true, faceEnrollment: "Enrolled", fingerprintEnrollment: "Enrolled" } });
    const credential = randomBytes(32).toString("base64url");
    deviceId = (await prisma.developmentCheckInDevice.create({ data: { terminalId, credentialHash: digest(credential), fakeStudentId: student.id, fakeFaceOutcome: "MATCH", fakeFingerprintOutcome: "NO_MATCH" } })).id;
    const deviceRequest = (step: string, attemptId?: string) => fetch(`${base}/terminals/${terminalId}/check-ins/${step}-verification`, { method: "POST", headers: { Authorization: `Bearer ${credential}`, ...(attemptId ? { "Content-Type": "application/json" } : {}) }, ...(attemptId ? { body: JSON.stringify({ attemptId }) } : {}) });
    const failedAttempt = await (await deviceRequest("face")).json();
    assert.equal((await deviceRequest("fingerprint", failedAttempt.attemptId)).status, 422);
    assert.equal((await lecturerBrowser.api.getLecturerSessionDetail(opened.id)).attendance.length, 0);
    await prisma.developmentCheckInDevice.update({ where: { id: deviceId }, data: { fakeFingerprintOutcome: "MATCH" } });
    const attempt = await (await deviceRequest("face")).json();
    assert.equal((await deviceRequest("fingerprint", attempt.attemptId)).status, 201);
    assert.equal((await deviceRequest("fingerprint", attempt.attemptId)).status, 200);
    const register = await lecturerBrowser.api.getLecturerSessionDetail(opened.id);
    assert.equal(register.attendance.length, 1); assert.equal(register.attendance[0].studentId, student.id); assert.equal(register.attendance[0].indexNumber, student.studentId.toUpperCase()); assert.ok(register.attendance[0].recordedAt);
    await lecturerBrowser.api.closeLecturerSession(opened.id); assert.equal((await display()).activeSession, null);
    assert.equal((await lecturerBrowser.api.getLecturerSessionDetail(opened.id)).attendance.length, 1);
    assert.equal((await adminBrowser.api.getSessionDetail(opened.id)).attendance.length, 1);
    const report = await lecturerBrowser.request<{ attendanceRecords: { sessionId: string }[] }>(`/lecturer/reports/attendance?sectionId=${section.id}`);
    assert.equal(report.attendanceRecords.filter(row => row.sessionId === opened.id).length, 1);
    assert.ok((await adminBrowser.api.getAuditEvents()).some(event => event.action === "Recorded attendance check-in"));
    await adminBrowser.api.updateSectionRoster(section.id, student.id, "remove");
    assert.equal((await lecturerBrowser.api.getLecturerClasses()).find(row => row.id === section.id)?.students.length, 0);
    assert.equal((await lecturerBrowser.api.getLecturerSessionDetail(opened.id)).attendance.length, 1);
    const bulk = Array.from({ length: 101 }, (_, i) => ({ id: randomUUID(), studentId: `BULK-${i}-${unique}`.toUpperCase(), name: `Fictional bulk ${i}`, program: "Test", department: "Test", level: "100", classSectionId: section.id }));
    studentIds.push(...bulk.map(row => row.id)); await prisma.student.createMany({ data: bulk });
    const allStudents = await adminBrowser.api.getStudents();
    assert.ok(allStudents.length >= 102); assert.ok(adminBrowser.paths.some(path => path.includes("/admin/students?page=2")));
    await adminBrowser.api.setStaffStatus(staff[0].id, "Inactive");
    const updatedSection = await adminBrowser.api.saveSection({ ...section, schedule: "Updated after deactivation" }, section.id);
    assert.equal(updatedSection.schedule, "Updated after deactivation"); // unchanged inactive lecturer is not resubmitted as a reassignment
    assert.equal(updatedSection.lecturerId, staff[0].id);
    assert.equal(await lecturerBrowser.api.getCurrentUser(), null);
    await adminBrowser.api.signOut(); assert.equal(await adminBrowser.api.getCurrentUser(), null);
    await assert.rejects(adminBrowser.api.getStudents(), /401/);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await prisma.auditEntry.deleteMany({ where: { OR: [{ actorId: { in: staffIds } }, ...(deviceId ? [{ deviceActorId: deviceId }] : [])] } });
    if (deviceId) { await prisma.faceVerificationAttempt.deleteMany({ where: { deviceId } }); await prisma.attendanceRecord.deleteMany({ where: { deviceId } }); await prisma.developmentCheckInDevice.delete({ where: { id: deviceId } }); }
    if (sectionId) { await prisma.attendanceSession.deleteMany({ where: { sectionId } }); await prisma.sectionRosterMembership.deleteMany({ where: { sectionId } }); }
    await prisma.studentConsent.deleteMany({ where: { studentId: { in: studentIds } } }); await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
    if (sectionId) await prisma.classSection.delete({ where: { id: sectionId } }); await prisma.terminal.deleteMany({ where: { id: terminalId } });
    await prisma.course.deleteMany({ where: { id: { in: courseIds } } }); await prisma.staff.deleteMany({ where: { id: { in: staffIds } } }); await prisma.$disconnect();
    if (oldMode === undefined) delete process.env.CHECK_IN_MODE; else process.env.CHECK_IN_MODE = oldMode;
    if (oldEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnvironment;
    if (oldCapture === undefined) delete process.env.BIOMETRIC_CAPTURE_MODE; else process.env.BIOMETRIC_CAPTURE_MODE = oldCapture;
  }
});
