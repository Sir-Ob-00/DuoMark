import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { HttpError } from "../utils/http-error.js";

async function lockReferences(tx: Prisma.TransactionClient, sectionId: string, studentId: string) {
  // Serialize membership writes and assignment changes on the section. Foreign
  // keys and the student lock also protect references against concurrent deletes.
  const sections = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "ClassSection" WHERE "id" = ${sectionId} FOR UPDATE`;
  if (!sections.length) throw new HttpError(404, "Class section not found");
  const students = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Student" WHERE "id" = ${studentId} FOR KEY SHARE`;
  if (!students.length) throw new HttpError(404, "Student not found");
}
export async function addRosterStudent(sectionId: string, studentId: string, actorId: string) {
  try {
    return await prisma.$transaction(async tx => {
      await lockReferences(tx, sectionId, studentId);
      const membership = await tx.sectionRosterMembership.create({ data: { sectionId, studentId } });
      await tx.auditEntry.create({ data: { actorId, sectionId, action: "ROSTER_STUDENT_ADDED", details: { studentId } } });
      return membership;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new HttpError(409, "Student is already on the section roster");
    throw error;
  }
}
export async function removeRosterStudent(sectionId: string, studentId: string, actorId: string) {
  await prisma.$transaction(async tx => {
    await lockReferences(tx, sectionId, studentId);
    const deleted = await tx.sectionRosterMembership.deleteMany({ where: { sectionId, studentId } });
    if (!deleted.count) throw new HttpError(404, "Roster membership not found");
    await tx.auditEntry.create({ data: { actorId, sectionId, action: "ROSTER_STUDENT_REMOVED", details: { studentId } } });
    // Delete only the membership: never the student or any attendance history.
  });
}
