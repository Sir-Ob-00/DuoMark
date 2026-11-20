import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import ExcelJS from "exceljs";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { authConfig } from "../src/config/auth.js";
import { digest } from "../src/services/auth.service.js";
import { commitStudentImport } from "../src/services/student-import.service.js";
import { parseStudentFile } from "../src/services/student-import-file.service.js";
import type { ImportValidation } from "../src/validation/student-import.validation.js";

test("student import: downloaded templates, preview/atomic commit, headers, duplicates, text IDs and authorization", async () => {
  const unique = randomUUID(), staffIds: string[] = [], cookies: string[] = [], indices = new Set<string>();
  let courseId: number | undefined, sectionId: string | undefined;
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/v1`, root = `${base}/admin/student-imports`;
  const headers = { Origin: authConfig.origins[0], "X-CSRF-Protection": "1", "Content-Type": "application/octet-stream" };
  const upload = (file: Buffer | string, operation = "validate", format = "csv", cookie = cookies[0]) => fetch(`${root}/${operation}?format=${format}`, { method: "POST", headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) }, body: new Uint8Array(typeof file === "string" ? Buffer.from(file) : file) });
  const get = (path: string, cookie = cookies[0]) => fetch(root + path, { headers: cookie ? { Cookie: cookie } : {} });
  const index = (prefix: string) => { const value = `${prefix}-${unique}`.toUpperCase(); indices.add(value); return value; };
  const values = (studentId: string, name = "Fictional imported student") => [studentId, name, "Computing", "ICT", "100", sectionId!];
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  let header: string[] = [];
  const csv = (rows: string[][], columns = header) => Buffer.from(`\uFEFF${[columns, ...rows].map(row => row.map(quote).join(",")).join("\r\n")}\r\n`);
  const preview = async (file: Buffer, format = "csv") => { const response = await upload(file, "validate", format); assert.equal(response.status, 200); return await response.json() as ImportValidation; };
  const count = () => prisma.student.count({ where: { studentId: { in: [...indices] } } });
  async function workbookFrom(buffer: Buffer) { const book = new ExcelJS.Workbook(); await book.xlsx.load(buffer as unknown as Parameters<typeof book.xlsx.load>[0]); return book; }
  try {
    for (let i = 0; i < 2; i++) {
      const staff = await prisma.staff.create({ data: { name: `Import fixture ${i}`, email: `import-${i}-${unique}@example.test`, role: i ? "LECTURER" : "ADMIN" } }); staffIds.push(staff.id);
      const token = randomBytes(32).toString("base64url"); cookies.push(`${authConfig.cookieName}=${token}`); await prisma.staffSession.create({ data: { staffId: staff.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 60000) } });
    }
    courseId = (await prisma.course.create({ data: { code: `IMPORT-${unique}`.toUpperCase(), title: "Import roster fixture" } })).id;
    sectionId = (await prisma.classSection.create({ data: { courseId, lecturerId: staffIds[1], code: "A", academicYear: "2026/2027", term: "TEST", room: "Test", schedule: "Test" } })).id;
    const schema = await (await get("/schema")).json(); assert.equal(schema.columns.length, 6); assert.ok(schema.columns.every((col: { required: boolean }) => col.required));
    const csvTemplate = await get("/templates/csv"); assert.equal(csvTemplate.status, 200); assert.equal(csvTemplate.headers.get("cache-control"), "no-store"); assert.match(csvTemplate.headers.get("content-disposition")!, /template.csv/);
    const templateText = await csvTemplate.text(); header = templateText.replace(/^\uFEFF/, "").trim().split(","); assert.deepEqual(header, ["Student ID", "Full name", "Programme", "Department", "Level", "Class section"]);
    const numericIndex = BigInt(`0x${unique.replaceAll("-", "").slice(0, 16)}`);
    const csvId = `000${numericIndex}`; indices.add(csvId);
    const csvFile = csv([values(csvId, 'Import, "quoted" student')]);
    const validation = await preview(csvFile); assert.equal(validation.canImport, true); assert.deepEqual(validation.summary, { totalRows: 1, validRows: 1, errorRows: 0 }); assert.equal(validation.rows[0].rowNumber, 2); assert.equal(await count(), 0);
    assert.equal(await prisma.auditEntry.count({ where: { actorId: staffIds[0] } }), 0);
    const committed = await upload(csvFile, "commit"); assert.equal(committed.status, 201); assert.deepEqual(await committed.json(), { importedCount: 1 });
    const first = await prisma.student.findUniqueOrThrow({ where: { studentId: csvId } }); assert.equal(first.studentId, csvId); assert.equal(first.faceEnrollment, "Pending"); assert.equal(first.fingerprintEnrollment, "Pending");
    assert.equal(await prisma.studentConsent.count({ where: { studentId: first.id } }), 0); assert.equal(await prisma.sectionRosterMembership.count({ where: { studentId: first.id } }), 0);
    const excelTemplateResponse = await get("/templates/xlsx"); assert.equal(excelTemplateResponse.status, 200);
    const excelTemplate = Buffer.from(await excelTemplateResponse.arrayBuffer()), workbook = await workbookFrom(excelTemplate);
    assert.equal(workbook.worksheets[0].getColumn(1).numFmt, "@");
    const xlsxId = `000${numericIndex + 1n}`; indices.add(xlsxId); workbook.worksheets[0].addRow([]); workbook.worksheets[0].addRow(values(xlsxId));
    const xlsxFile = Buffer.from(await workbook.xlsx.writeBuffer()); const excelPreview = await preview(xlsxFile, "xlsx"); assert.equal(excelPreview.rows[0].values.studentId, xlsxId); assert.equal(excelPreview.rows[0].rowNumber, 3); assert.equal(excelPreview.summary.totalRows, 1); assert.equal(await count(), 1);
    assert.equal((await upload(xlsxFile, "commit", "xlsx")).status, 201); assert.equal(await count(), 2);
    const reorderedId = index("000ORDER"), reordered = values(reorderedId);
    const reorderedFile = csv([reordered.slice().reverse(), ["", "", "", "", "", ""]], header.slice().reverse().map(value => ` ${value} `));
    const reorderedPreview = await preview(reorderedFile); assert.equal(reorderedPreview.canImport, true); assert.equal(reorderedPreview.summary.totalRows, 1); assert.equal(reorderedPreview.rows[0].values.studentId, reorderedId);
    const leadingBlank = await preview(Buffer.concat([Buffer.from("\r\n"), csv([values(reorderedId)]).subarray(3)])); assert.equal(leadingBlank.rows[0].rowNumber, 3);
    for (const [columns, pattern] of [[header.slice(1), /Missing required header: Student ID/], [[...header, "Student ID"], /Duplicate header/], [[...header, "password"], /Unrecognized header/], [[...header, "studentId"], /Duplicate header/]] as [string[], RegExp][]) {
      const result = await preview(csv([values(index("HEADERS"))], columns)); assert.equal(result.canImport, false); assert.match(result.headerErrors.join(" "), pattern); assert.equal(result.rows.length, 0);
    }
    const invalid = values(index("INVALID")); invalid[1] = " "; invalid[4] = "0";
    const invalidFile = csv([invalid]); const invalidPreview = await preview(invalidFile); assert.equal(invalidPreview.summary.errorRows, 1); assert.ok(invalidPreview.rows[0].errors.some(error => error.field === "name")); assert.ok(invalidPreview.rows[0].errors.some(error => error.field === "level"));
    assert.equal((await upload(invalidFile, "commit")).status, 422); assert.equal(await count(), 2);
    const duplicateId = index("DUPLICATE"), duplicates = await preview(csv([values(` ${duplicateId.toLowerCase()} `), values(duplicateId)])); assert.equal(duplicates.summary.errorRows, 2);
    assert.ok(duplicates.rows.every(row => row.errors.some(error => error.code === "duplicate-file")));
    assert.equal((await preview(csv([values(csvId)]))).rows[0].errors[0].code, "duplicate-database");
    assert.equal((await upload(csv([values(csvId, "Do not overwrite")]), "commit")).status, 409); assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: first.id } })).name, first.name);
    const numericBook = await workbookFrom(excelTemplate); numericBook.worksheets[0].addRow([123, ...values(index("NUMERIC")).slice(1)]);
    const numericPreview = await preview(Buffer.from(await numericBook.xlsx.writeBuffer()), "xlsx"); assert.ok(numericPreview.rows[0].errors.some(error => /stored as text/.test(error.message)));
    const formulaBook = await workbookFrom(excelTemplate); formulaBook.worksheets[0].addRow(values(index("FORMULA"))); formulaBook.worksheets[0].getCell("E2").value = { formula: "50+50", result: 100 };
    assert.equal((await preview(Buffer.from(await formulaBook.xlsx.writeBuffer()), "xlsx")).canImport, false);
    const reorderedBook = await workbookFrom(excelTemplate); reorderedBook.worksheets[0].getRow(1).values = header.slice().reverse().map(label => ` ${label} `); reorderedBook.worksheets[0].addRow(values(index("XLSX-ORDER")).reverse()); assert.equal((await preview(Buffer.from(await reorderedBook.xlsx.writeBuffer()), "xlsx")).canImport, true);
    const expandedBook = await workbookFrom(excelTemplate); expandedBook.worksheets[0].getCell("A2").value = "X".repeat(5 * 1024 * 1024 + 1); assert.equal((await upload(Buffer.from(await expandedBook.xlsx.writeBuffer()), "validate", "xlsx")).status, 413);
    const newId = index("CONFLICT-NEW"), takenId = index("CONFLICT-TAKEN"), conflictFile = csv([values(newId), values(takenId)]); assert.equal((await preview(conflictFile)).canImport, true);
    await prisma.student.create({ data: { studentId: takenId, name: "Concurrent manual profile", program: "Computing", department: "ICT", level: "100", classSectionId: sectionId } });
    const conflict = await upload(conflictFile, "commit"); assert.equal(conflict.status, 409); const conflictBody = await conflict.json(); assert.equal(conflictBody.validation.rows[1].rowNumber, 3); assert.equal(await prisma.student.count({ where: { studentId: newId } }), 0);
    const auditFailureId = index("AUDIT-ROLLBACK"), auditFile = await parseStudentFile(csv([values(auditFailureId)]), "csv"); await assert.rejects(commitStudentImport(auditFile, randomUUID())); assert.equal(await prisma.student.count({ where: { studentId: auditFailureId } }), 0);
    const raceId = index("RACE"), raceFile = csv([values(raceId)]); const race = await Promise.all([upload(raceFile, "commit"), upload(raceFile, "commit")]); assert.deepEqual(race.map(response => response.status).sort(), [201, 409]); assert.equal(await prisma.student.count({ where: { studentId: raceId } }), 1);
    for (const path of ["/schema", "/templates/csv", "/templates/xlsx"]) assert.equal((await get(path, cookies[1])).status, 403);
    for (const operation of ["validate", "commit"]) { assert.equal((await upload(csvFile, operation, "csv", cookies[1])).status, 403); assert.equal((await upload(csvFile, operation, "csv", "")).status, 401); }
    assert.equal((await fetch(`${root}/validate?format=csv`, { method: "POST", headers: { ...headers, Cookie: cookies[0], "X-CSRF-Protection": "" }, body: csvFile })).status, 403);
    assert.equal((await upload(Buffer.alloc(2 * 1024 * 1024 + 1))).status, 413);
    assert.equal((await upload(csv(Array.from({ length: 1001 }, (_, i) => values(`${i}-${unique}`))))).status, 413);
    assert.equal((await upload(Buffer.from("not an Excel workbook"), "validate", "xlsx")).status, 400);
    assert.equal((await upload(csvFile, "validate", "xls")).status, 400);
    const list = await (await fetch(`${base}/admin/students?search=${xlsxId}`, { headers: { Cookie: cookies[0] } })).json(); assert.equal(list.students[0].studentId, xlsxId);
    const rosterAdd = await fetch(`${base}/class-sections/${sectionId}/roster/${first.id}`, { method: "PUT", headers: { ...headers, Cookie: cookies[0] } }); assert.equal(rosterAdd.status, 201);
    const classes = await (await fetch(`${base}/lecturer/classes`, { headers: { Cookie: cookies[1] } })).json(); assert.equal(classes.classes.find((section: { id: string }) => section.id === sectionId).students[0].id, first.id);
    const audits = await prisma.auditEntry.findMany({ where: { actorId: staffIds[0], action: "STUDENT_CREATED" } }); assert.equal(audits.length, 3); assert.ok(audits.every(audit => (audit.details as { source: string }).source === "IMPORT"));
    assert.equal((await fetch(base.replace("/api/v1", "/health"))).status, 200);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await prisma.auditEntry.deleteMany({ where: { actorId: { in: staffIds } } });
    if (sectionId) await prisma.sectionRosterMembership.deleteMany({ where: { sectionId } });
    await prisma.student.deleteMany({ where: { studentId: { in: [...indices] } } });
    if (sectionId) await prisma.classSection.delete({ where: { id: sectionId } }); if (courseId) await prisma.course.delete({ where: { id: courseId } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } }); await prisma.$disconnect();
  }
});
