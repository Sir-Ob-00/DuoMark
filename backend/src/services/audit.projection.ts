import type { AuditAction, Prisma } from "../generated/prisma/client.js";

export const auditLabels: Record<AuditAction, string> = {
  STUDENT_CREATED: "Created student profile", STUDENT_UPDATED: "Updated student profile", STUDENT_CONSENT_RECORDED: "Recorded enrollment consent",
  BIOMETRIC_REQUESTED: "Requested biometric enrollment change", BIOMETRIC_COMPLETED: "Completed biometric enrollment change", BIOMETRIC_CANCELLED: "Cancelled biometric enrollment attempt",
  LECTURER_CREATED: "Created lecturer profile", LECTURER_UPDATED: "Updated lecturer profile", LECTURER_STATUS_CHANGED: "Changed lecturer status",
  LECTURER_INVITATION_ATTEMPTED: "Attempted lecturer invitation", COURSE_CREATED: "Created course", COURSE_UPDATED: "Updated course",
  CLASS_SECTION_CREATED: "Created class section", CLASS_SECTION_UPDATED: "Updated class section", ROSTER_STUDENT_ADDED: "Added student to class roster", ROSTER_STUDENT_REMOVED: "Removed student from class roster",
  TERMINAL_REGISTERED: "Registered attendance terminal", TERMINAL_UPDATED: "Updated attendance terminal", TERMINAL_AVAILABILITY_CHANGED: "Changed terminal availability",
  SESSION_OPENED: "Opened attendance session", SESSION_CLOSED: "Closed attendance session", ATTENDANCE_RECORDED: "Recorded attendance check-in",
  REPORT_EXPORT_REPORTED: "Received client-reported CSV export",
  LECTURER_ACTIVATED: "Activated lecturer account",
};
// No credential columns, raw details, enrollment state or verification payloads
// are selected for the list. All actor/target labels are approved display fields.
export const auditSummarySelect = { id: true, action: true, timestamp: true, reportId: true,
  actor: { select: { id: true, name: true } },
  deviceActor: { select: { id: true, terminalId: true, terminal: { select: { name: true } } } },
  student: { select: { id: true, studentId: true, name: true } }, lecturer: { select: { id: true, name: true } },
  course: { select: { id: true, code: true, title: true } },
  section: { select: { id: true, code: true, academicYear: true, term: true, course: { select: { code: true } } } },
  terminal: { select: { id: true, name: true } },
  attendanceSession: { select: { id: true, courseCode: true, sectionCode: true } },
  attendanceRecord: { select: { id: true, studentIndexNumber: true, studentName: true } },
} satisfies Prisma.AuditEntrySelect;
type AuditSummary = Prisma.AuditEntryGetPayload<{ select: typeof auditSummarySelect }>;
function target(row: AuditSummary) {
  if (row.reportId === "attendance") return { type: "report", id: "attendance", label: "Attendance report" };
  if (row.student) return { type: "student", id: row.student.id, label: `${row.student.studentId} · ${row.student.name}` };
  if (row.lecturer) return { type: "lecturer", id: row.lecturer.id, label: row.lecturer.name };
  if (row.course) return { type: "course", id: row.course.id, label: `${row.course.code} · ${row.course.title}` };
  if (row.section) return { type: "section", id: row.section.id, label: `${row.section.course.code} · ${row.section.code} · ${row.section.academicYear} · ${row.section.term}` };
  if (row.terminal) return { type: "terminal", id: row.terminal.id, label: `${row.terminal.name} · ${row.terminal.id}` };
  if (row.attendanceSession) return { type: "session", id: row.attendanceSession.id, label: `${row.attendanceSession.courseCode} · ${row.attendanceSession.sectionCode}` };
  if (row.attendanceRecord) return { type: "attendance-record", id: row.attendanceRecord.id, label: `${row.attendanceRecord.studentIndexNumber} · ${row.attendanceRecord.studentName}` };
  throw new Error("Audit target invariant violated");
}
export function projectAuditSummary(row: AuditSummary) {
  const actorDetails = row.actor ? { type: "staff", id: row.actor.id, name: row.actor.name }
    : row.deviceActor ? { type: "device", id: row.deviceActor.id, name: `Device ${row.deviceActor.id} · ${row.deviceActor.terminal.name}`, terminalId: row.deviceActor.terminalId }
      : null;
  if (!actorDetails) throw new Error("Audit actor invariant violated");
  const targetDetails = target(row);
  return { id: row.id, eventType: row.action, action: auditLabels[row.action], actor: actorDetails.name, actorDetails,
    target: targetDetails.label, targetDetails, timestamp: row.timestamp };
}

// Deliberately narrow metadata: never return raw profile/before/after objects,
// hashes, opaque handles, consent documents/references or arbitrary JSON strings.
export function approvedAuditMetadata(action: AuditAction, value: Prisma.JsonValue): Record<string, unknown> {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const result: Record<string, unknown> = {};
  const enums = (key: string, allowed: readonly string[]) => { if (typeof source[key] === "string" && allowed.includes(source[key] as string)) result[key] = source[key]; };
  const boolean = (key: string) => { if (typeof source[key] === "boolean") result[key] = source[key]; };
  const uuid = (key: string) => { if (typeof source[key] === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(source[key] as string)) result[key] = source[key]; };
  const timestamp = (key: string) => { const date = source[key]; if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(date) && Number.isFinite(Date.parse(date))) result[key] = date; };
  const fields: Record<string, string[]> = {
    STUDENT_CREATED: ["studentId", "name", "program", "department", "level", "classSectionId"], STUDENT_UPDATED: ["studentId", "name", "program", "department", "level", "classSectionId"],
    LECTURER_CREATED: ["name", "email"], LECTURER_UPDATED: ["name", "email"], COURSE_CREATED: ["code", "name", "department"], COURSE_UPDATED: ["code", "name", "department"],
    CLASS_SECTION_CREATED: ["code", "courseId", "lecturerId", "room", "schedule", "academicYear", "term"], CLASS_SECTION_UPDATED: ["code", "courseId", "lecturerId", "room", "schedule", "academicYear", "term"],
    TERMINAL_REGISTERED: ["id", "name", "location"], TERMINAL_UPDATED: ["name", "location"],
  };
  if (fields[action]) {
    if (Array.isArray(source.changedFields)) result.changedFields = [...new Set(source.changedFields.filter((field): field is string => typeof field === "string" && fields[action].includes(field)))];
    const profile = source.profile;
    if (profile && typeof profile === "object" && !Array.isArray(profile)) result.fields = Object.keys(profile).filter(field => fields[action].includes(field));
  }
  if (action === "LECTURER_STATUS_CHANGED" || action === "TERMINAL_AVAILABILITY_CHANGED") {
    const statuses = action === "LECTURER_STATUS_CHANGED" ? ["Active", "Inactive"] : ["Available", "Unavailable"];
    enums("before", statuses); enums("after", statuses);
    if (action === "LECTURER_STATUS_CHANGED" && Number.isSafeInteger(source.sessionsRevoked) && (source.sessionsRevoked as number) >= 0) result.sessionsRevoked = source.sessionsRevoked;
  }
  if (action === "LECTURER_CREATED") { enums("status", ["Active", "Inactive"]); boolean("provisioned"); }
  if (action === "TERMINAL_REGISTERED") enums("status", ["Available", "Unavailable"]);
  if (action === "STUDENT_CONSENT_RECORDED") result.consentRecorded = true;
  if (action === "ROSTER_STUDENT_ADDED" || action === "ROSTER_STUDENT_REMOVED") uuid("studentId");
  if (action.startsWith("BIOMETRIC_")) {
    enums("modality", ["face", "fingerprint"]); enums("operation", ["ENROLL", "REMOVE", "RESET"]);
    enums("reason", ["expired", "superseded_by_deletion"]); boolean("identityVerified"); boolean("deletionConfirmed"); boolean("developmentOnly");
    for (const key of ["serviceId", "completingServiceId"]) enums(key, ["development-fake-capture"]);
    for (const key of ["deviceId", "completingDeviceId"]) { uuid(key); if (source[key] === "development-fake-device") result[key] = source[key]; }
  }
  if (action === "SESSION_OPENED" || action === "SESSION_CLOSED") {
    uuid("sectionId"); timestamp(action === "SESSION_OPENED" ? "openedAt" : "closedAt"); boolean("developmentOnly"); boolean("fictionalFixture");
  }
  if (action === "ATTENDANCE_RECORDED") { uuid("sessionId"); enums("serviceId", ["development-fake-fingerprint-capture"]); boolean("developmentOnly"); }
  if (action === "LECTURER_INVITATION_ATTEMPTED") {
    enums("outcome", ["UNAVAILABLE", "REJECTED_INACTIVE", "REJECTED_ALREADY_PROVISIONED", "PREPARED", "ACCEPTED", "DELIVERY_UNCONFIRMED"]);
    enums("deliveryStatus", ["NOT_ATTEMPTED", "PENDING", "ACCEPTED", "UNCONFIRMED"]); enums("provisioningStatus", ["NOT_ATTEMPTED"]);
  }
  if (action === "LECTURER_ACTIVATED") enums("outcome", ["ACTIVATED"]);
  if (action === "REPORT_EXPORT_REPORTED") {
    result.clientReported = true;
    enums("role", ["ADMIN", "LECTURER"]);
    enums("scope", ["all-official-attendance", "closed-owned-currently-assigned-sections"]);
    if (Number.isSafeInteger(source.matchingRecordsAtReceipt) && (source.matchingRecordsAtReceipt as number) >= 0) result.matchingRecordsAtReceipt = source.matchingRecordsAtReceipt;
    const filters = source.filters;
    if (filters && typeof filters === "object" && !Array.isArray(filters)) {
      const safe: Record<string, unknown> = {};
      const raw = filters as Record<string, unknown>;
      if (Number.isSafeInteger(raw.courseId) && (raw.courseId as number) > 0 && (raw.courseId as number) <= 2147483647) safe.courseId = raw.courseId;
      for (const key of ["sectionId", "lecturerId"]) if (typeof raw[key] === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw[key] as string)) safe[key] = raw[key];
      for (const key of ["dateFrom", "dateTo"]) if (typeof raw[key] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw[key] as string)) safe[key] = raw[key];
      result.filters = safe;
    }
  }
  return result;
}
