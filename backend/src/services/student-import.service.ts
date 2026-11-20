import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { studentInput } from "../validation/student.validation.js";
import { importHeaders, validateImportRow, type ImportValidation } from "../validation/student-import.validation.js";
import type { parseStudentFile } from "./student-import-file.service.js";

type FileRows = Awaited<ReturnType<typeof parseStudentFile>>;
async function validateRows(file: FileRows, db: Pick<Prisma.TransactionClient, "student">): Promise<ImportValidation> {
  const headers = importHeaders(file.headers);
  if (headers.errors.length) return { summary: { totalRows: file.rows.length, validRows: 0, errorRows: 0 }, headerErrors: headers.errors, rows: [], canImport: false };
  if (!file.rows.length) return { summary: { totalRows: 0, validRows: 0, errorRows: 0 }, headerErrors: ["No student rows found after the header."], rows: [], canImport: false };
  const rows = file.rows.map(row => validateImportRow(row, headers.fields));
  const occurrences = new Map<string, number[]>();
  for (const row of rows) {
    if (row.errors.some(error => error.field === "studentId") || !row.values.studentId) continue;
    const numbers = occurrences.get(row.values.studentId) ?? []; numbers.push(row.rowNumber); occurrences.set(row.values.studentId, numbers);
  }
  const existing = new Set((await db.student.findMany({ where: { studentId: { in: [...occurrences.keys()] } }, select: { studentId: true } })).map(row => row.studentId));
  for (const row of rows) {
    const index = row.values.studentId;
    if (!index) continue;
    const same = occurrences.get(index) ?? [];
    if (same.length > 1) row.errors.push({ field: "studentId", code: "duplicate-file", message: `Duplicate Student ID in file (rows ${same.join(", ")}).` });
    if (existing.has(index)) row.errors.push({ field: "studentId", code: "duplicate-database", message: "Student ID already exists in the database; existing profiles are not overwritten." });
  }
  const errorRows = rows.filter(row => row.errors.length).length;
  return { summary: { totalRows: rows.length, validRows: rows.length - errorRows, errorRows }, headerErrors: [], rows, canImport: errorRows === 0 };
}
export const previewStudentImport = (file: FileRows) => validateRows(file, prisma);
export async function commitStudentImport(file: FileRows, actorId: string) {
  try {
    return await prisma.$transaction(async tx => {
      // Revalidate the original uploaded bytes against the current DB snapshot;
      // never trust the browser's preview rows, counts or success flags.
      const validation = await validateRows(file, tx);
      if (!validation.canImport) return { status: validation.rows.some(row => row.errors.some(error => error.code === "duplicate-database")) ? 409 : 422,
        body: { error: "Import not saved. Correct the file errors and validate again.", validation } };
      const records = validation.rows.map(row => ({ id: randomUUID(), ...studentInput(row.values, false) }));
      await tx.student.createMany({ data: records });
      await tx.auditEntry.createMany({ data: records.map((student, index) => {
        const { id, ...profile } = student;
        return { id: randomUUID(), actorId, studentId: id, action: "STUDENT_CREATED" as const,
          details: { profile, source: "IMPORT", rowNumber: validation.rows[index].rowNumber } };
      }) });
      return { status: 201, body: { importedCount: records.length } };
    }, { timeout: 30000, maxWait: 10000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // A concurrent manual add/import won the unique index after validation.
      // The insert and all audit rows have rolled back before this re-read.
      const validation = await validateRows(file, prisma);
      return { status: 409, body: { error: "Import rolled back: a Student ID was created concurrently. Review the indicated rows and upload a corrected file.", validation } };
    }
    throw error;
  }
}
