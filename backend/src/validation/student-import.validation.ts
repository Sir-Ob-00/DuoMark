import { profileFields, studentInput, type StudentInput } from "./student.validation.js";
import { HttpError } from "../utils/http-error.js";

export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 1000;
const labels: Record<keyof StudentInput, string> = { studentId: "Student ID", name: "Full name", program: "Programme", department: "Department", level: "Level", classSectionId: "Class section" };
const rules: Record<keyof StudentInput, string> = {
  studentId: "Required, unique index number; text, up to 64 letters/digits or / _ -. Uppercased by the server. Keep leading zeroes as text.",
  name: "Required full name, up to 200 characters.", program: "Required programme, up to 150 characters.",
  department: "Required department, up to 150 characters.", level: "Required level from 1 to 999 (no leading zeroes).",
  classSectionId: "Required profile class-section identifier, up to 100 letters/digits, _ or -. Use the ID from the class-section list; this does not add a roster membership.",
};
export const importColumns = profileFields.map(field => ({ field, label: labels[field], required: true, rules: rules[field] }));
export type ImportIssue = { field: string; message: string; code?: string };
export type ImportRow = { rowNumber: number; values: Partial<StudentInput>; errors: ImportIssue[] };
export type ImportValidation = { summary: { totalRows: number; validRows: number; errorRows: number }; headerErrors: string[]; rows: ImportRow[]; canImport: boolean };
export type SourceRow = { rowNumber: number; cells: string[]; errors?: ImportIssue[] };
export function importFormat(value: unknown) {
  if (value !== "csv" && value !== "xlsx") throw new HttpError(400, "format must be csv or xlsx");
  return value;
}
export function importHeaders(headers: string[]) {
  const map = new Map<string, keyof StudentInput>();
  for (const col of importColumns) { map.set(col.field.toLowerCase(), col.field); map.set(col.label.toLowerCase(), col.field); }
  const fields: (keyof StudentInput | undefined)[] = [], errors: string[] = [];
  const seen = new Set<string>();
  if (!headers.length) errors.push("The file has no header row.");
  for (const header of headers) {
    const normalized = header.trim().toLowerCase(), field = map.get(normalized);
    fields.push(field);
    if (!field) errors.push(`Unrecognized header: ${header.trim().slice(0, 100) || "(blank)"}`);
    if (seen.has(field ?? normalized)) errors.push(`Duplicate header: ${field ? labels[field] : header.trim().slice(0, 100)}`);
    seen.add(field ?? normalized);
  }
  for (const col of importColumns) if (col.required && !seen.has(col.field)) errors.push(`Missing required header: ${col.label}`);
  return { fields, errors };
}
export function validateImportRow(row: SourceRow, fields: (keyof StudentInput | undefined)[]): ImportRow {
  const values: Partial<StudentInput> = {}, errors = [...(row.errors ?? [])];
  if (row.cells.length > fields.length && row.cells.slice(fields.length).some(value => value.trim())) errors.push({ field: "row", message: "Row contains values beyond the header columns." });
  fields.forEach((field, index) => {
    if (!field) return;
    const value = row.cells[index] ?? "";
    values[field] = value.trim().slice(0, 200);
    if (errors.some(issue => issue.field === field)) return;
    try { values[field] = studentInput({ [field]: value }, true)[field]; }
    catch (error) { errors.push({ field, message: error instanceof HttpError ? error.message : "Invalid value" }); }
  });
  if (!errors.length) studentInput(values, false); // Same complete create contract.
  return { rowNumber: row.rowNumber, values, errors };
}
