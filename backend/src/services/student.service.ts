import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import type { StudentInput } from "../validation/student.validation.js";
import type { studentQuery, consentInput } from "../validation/student.validation.js";
import { HttpError } from "../utils/http-error.js";
import { attemptSelect } from "./capture.service.js";

const profileSelect = { id: true, studentId: true, name: true, program: true, department: true, level: true,
  classSectionId: true, faceEnrollment: true, fingerprintEnrollment: true } as const;
type PublicStudent = Prisma.StudentGetPayload<{ select: typeof profileSelect }>;
function profile(student: PublicStudent) {
  return { ...student, enrollmentStatus: student.faceEnrollment === "Enrolled" && student.fingerprintEnrollment === "Enrolled" ? "Enrolled" : "Pending" };
}
const consentSelect = { id: true, studentId: true, recordedAt: true, verifiedById: true, consentVersion: true, consentReference: true } as const;
async function enrollment(client: Prisma.TransactionClient, id: string) {
  const student = await client.student.findUnique({ where: { id }, select: {
    faceEnrollment: true, fingerprintEnrollment: true,
    consents: { orderBy: [{ recordedAt: "desc" }, { id: "desc" }], take: 1, select: consentSelect },
    captureAttempts: { orderBy: [{ requestedAt: "desc" }, { id: "desc" }], take: 20, select: attemptSelect },
  } });
  if (!student) throw new HttpError(404, "Student not found");
  return { studentId: id, consentRecorded: student.consents.length > 0, face: student.faceEnrollment,
    fingerprint: student.fingerprintEnrollment, consent: student.consents[0] ?? null,
    ...(student.captureAttempts.length ? { attempts: student.captureAttempts } : {}) };
}
export async function listStudents(query: ReturnType<typeof studentQuery>) {
  const where: Prisma.StudentWhereInput = { ...query.filters };
  if (query.search) where.OR = ["name", "studentId"].map(field => ({ [field]: { contains: query.search, mode: "insensitive" } }));
  if (query.status === "Enrolled") Object.assign(where, { faceEnrollment: "Enrolled", fingerprintEnrollment: "Enrolled" });
  if (query.status === "Pending") where.NOT = { faceEnrollment: "Enrolled", fingerprintEnrollment: "Enrolled" };
  return prisma.$transaction(async tx => {
    const total = await tx.student.count({ where });
    const rows = await tx.student.findMany({ where, select: profileSelect, orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: (query.page - 1) * query.limit, take: query.limit });
    return { students: rows.map(profile), pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
export async function getStudent(id: string) {
  const student = await prisma.student.findUnique({ where: { id }, select: profileSelect });
  if (!student) throw new HttpError(404, "Student not found");
  return profile(student);
}
export async function createStudent(input: StudentInput, actorId: string) {
  return prisma.$transaction(async tx => {
    const student = await tx.student.create({ data: input, select: profileSelect });
    await tx.auditEntry.create({ data: { actorId, studentId: student.id, action: "STUDENT_CREATED", details: { profile: input } } });
    return profile(student);
  });
}
export async function updateStudent(id: string, input: Partial<StudentInput>, actorId: string) {
  return prisma.$transaction(async tx => {
    // Serialize updates so audit before/after values describe the actual change.
    await tx.$queryRaw`SELECT "id" FROM "Student" WHERE "id" = ${id} FOR UPDATE`;
    const before = await tx.student.findUnique({ where: { id }, select: profileSelect });
    if (!before) throw new HttpError(404, "Student not found");
    const changedFields = (Object.keys(input) as (keyof StudentInput)[]).filter(key => before[key] !== input[key]);
    if (!changedFields.length) return profile(before);
    const student = await tx.student.update({ where: { id }, data: input, select: profileSelect });
    const oldValues = Object.fromEntries(changedFields.map(key => [key, before[key]]));
    const newValues = Object.fromEntries(changedFields.map(key => [key, student[key]]));
    await tx.auditEntry.create({ data: { actorId, studentId: id, action: "STUDENT_UPDATED", details: { changedFields, before: oldValues, after: newValues } } });
    return profile(student);
  });
}
export const getEnrollment = (id: string) => enrollment(prisma, id);
export async function recordConsent(id: string, input: ReturnType<typeof consentInput>, actorId: string) {
  return prisma.$transaction(async tx => {
    // Keep verification and its matching audit entry in one transaction.
    await tx.$queryRaw`SELECT "id" FROM "Student" WHERE "id" = ${id} FOR UPDATE`;
    if (!await tx.student.findUnique({ where: { id }, select: { id: true } })) throw new HttpError(404, "Student not found");
    const latest = await tx.studentConsent.findFirst({ where: { studentId: id }, orderBy: [{ recordedAt: "desc" }, { id: "desc" }] });
    // An exact retry of the latest verification must not append another success
    // event or reset its server timestamp. A changed verifier/version/reference
    // is a new verification and retains the append-only history behavior.
    if (latest && latest.verifiedById === actorId && latest.consentVersion === input.consentVersion && latest.consentReference === input.consentReference) return enrollment(tx, id);
    const consent = await tx.studentConsent.create({ data: { studentId: id, verifiedById: actorId, ...input }, select: consentSelect });
    await tx.auditEntry.create({ data: { actorId, studentId: id, action: "STUDENT_CONSENT_RECORDED", details: {
      consentId: consent.id, recordedAt: consent.recordedAt.toISOString(), ...input,
    } } });
    return { ...(await enrollment(tx, id)), consent };
  });
}
