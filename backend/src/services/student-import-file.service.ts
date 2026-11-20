import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import { fromBuffer } from "yauzl";
import { HttpError } from "../utils/http-error.js";
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, importColumns, type SourceRow, type ImportIssue } from "../validation/student-import.validation.js";

// Verify actual expanded byte counts before ExcelJS loads the workbook, so
// compressed uploads cannot bypass the memory bound with ZIP size metadata.
async function boundedWorkbookZip(buffer: Buffer) {
  await new Promise<void>((resolve, reject) => {
    fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) { reject(new HttpError(400, "Invalid XLSX workbook")); return; }
      let total = 0, entries = 0, stopped = false;
      const fail = () => { if (!stopped) { stopped = true; zip.close(); reject(new HttpError(413, "XLSX expanded content exceeds safe limits (20 MiB total, 5 MiB per entry, 200 entries)")); } };
      zip.on("error", () => { if (!stopped) { stopped = true; reject(new HttpError(400, "Invalid XLSX archive")); } });
      zip.on("end", () => { if (!stopped) resolve(); });
      zip.on("entry", entry => {
        if (++entries > 200 || entry.uncompressedSize > 5 * 1024 * 1024 || (entry.generalPurposeBitFlag & 1)) { fail(); return; }
        if (/\/$/.test(entry.fileName)) { zip.readEntry(); return; }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) { fail(); return; }
          let size = 0;
          stream.on("data", (chunk: Buffer) => { size += chunk.length; total += chunk.length; if (size > 5 * 1024 * 1024 || total > 20 * 1024 * 1024) { stream.destroy(); fail(); } });
          stream.on("error", fail);
          stream.on("end", () => { if (!stopped) zip.readEntry(); });
        });
      });
      zip.readEntry();
    });
  });
}
export async function parseStudentFile(buffer: Buffer, format: "csv" | "xlsx") {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new HttpError(400, "Choose a non-empty CSV or XLSX file");
  if (buffer.length > IMPORT_MAX_BYTES) throw new HttpError(413, "File exceeds the 2 MiB limit");
  const rows: SourceRow[] = [];
  let headers: string[] = [];
  const add = (row: SourceRow) => {
    if (!row.cells.some(value => value.trim()) && !row.errors?.length) return;
    rows.push(row);
    if (rows.length > IMPORT_MAX_ROWS) throw new HttpError(413, "File exceeds the limit of 1000 non-blank student rows");
  };
  try {
    if (format === "csv") {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      const records = parse(text, { bom: true, relax_column_count: true, skip_empty_lines: false, max_record_size: 65536 }) as string[][];
      const headerIndex = records.findIndex(cells => cells.some(value => value.trim()));
      headers = headerIndex < 0 ? [] : records[headerIndex];
      records.slice(headerIndex < 0 ? records.length : headerIndex + 1).forEach((cells, index) => add({ rowNumber: headerIndex + index + 2, cells }));
    } else {
      await boundedWorkbookZip(buffer);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
      if (workbook.worksheets.length !== 1) throw new HttpError(400, "XLSX must contain exactly one worksheet");
      const sheet = workbook.worksheets[0];
      let headerNumber = 0;
      sheet.eachRow((row, rowNumber) => { if (!headerNumber && row.values && Array.from({ length: row.cellCount }, (_, index) => row.getCell(index + 1).text).some(value => value.trim())) headerNumber = rowNumber; });
      const header = sheet.getRow(headerNumber || 1);
      if (header.cellCount > 128) throw new HttpError(400, "Too many header columns");
      headers = Array.from({ length: header.cellCount }, (_, index) => header.getCell(index + 1).text);
      const indexColumn = headers.findIndex(value => ["studentid", "student id"].includes(value.trim().toLowerCase())) + 1;
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber <= headerNumber) return;
        if (row.cellCount > 128) throw new HttpError(400, `Row ${rowNumber} has too many columns`);
        const errors: ImportIssue[] = [];
        const cells = Array.from({ length: row.cellCount }, (_, i) => {
          const cell = row.getCell(i + 1), value = cell.value;
          if (value === null || value === undefined) return "";
          const field = importColumns.find(col => [col.field.toLowerCase(), col.label.toLowerCase()].includes((headers[i] ?? "").trim().toLowerCase()))?.field ?? "row";
          if (i + 1 === indexColumn && typeof value !== "string" && !(typeof value === "object" && "richText" in value)) { errors.push({ field, message: "Student ID must be stored as text. Format the cell as Text and re-enter the original index number to preserve leading zeroes." }); return String(typeof value === "number" ? value : ""); }
          if (typeof value === "string") return value;
          if (typeof value === "number" && Number.isFinite(value)) return String(value);
          if (typeof value === "object" && "richText" in value) return value.richText.map(run => run.text).join("");
          errors.push({ field, message: "Use plain text or a numeric level; formulas, dates, booleans and hyperlinks are not accepted." });
          return "";
        });
        add({ rowNumber, cells, errors });
      });
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, format === "csv" ? "Could not parse CSV. Use UTF-8 CSV with valid quoting." : "Could not parse XLSX. Upload an unencrypted .xlsx workbook.");
  }
  if (headers.length > 128) throw new HttpError(400, "Too many header columns");
  return { headers, rows };
}
export async function studentTemplate(format: "csv" | "xlsx") {
  if (format === "csv") return Buffer.from(`\uFEFF${importColumns.map(col => col.label).join(",")}\r\n`, "utf8");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Students");
  sheet.columns = importColumns.map(col => ({ header: col.label, key: col.field, width: col.field === "classSectionId" ? 40 : 24, style: { numFmt: "@" } }));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
