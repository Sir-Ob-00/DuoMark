import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import type { StaffActor } from "../middleware/auth.js";
import type { reportExportInput } from "../validation/report-export.validation.js";
import { attendanceReportWhere } from "./attendance-report.service.js";
import { digest } from "./auth.service.js";
import { HttpError } from "../utils/http-error.js";

export async function reportExport(input: ReturnType<typeof reportExportInput>, actor: StaffActor) {
  const requestHash = digest(JSON.stringify({ reportId: input.reportId, role: actor.role, filters: input.filters }));
  return prisma.$transaction(async tx => {
    // Reuse the exact report authorization+filter SQL. A foreign lecturer's
    // section matches zero authorized rows, just as it does in the read API.
    const matchingRecordsAtReceipt = await tx.attendanceRecord.count({ where: attendanceReportWhere(input.query, actor) });
    const inserted = await tx.auditEntry.createMany({ data: [{ id: randomUUID(), actorId: actor.id, reportId: input.reportId,
      exportRequestId: input.requestId, action: "REPORT_EXPORT_REPORTED", details: {
        requestHash, filters: input.filters, role: actor.role, clientReported: true, matchingRecordsAtReceipt,
        scope: actor.role === "ADMIN" ? "all-official-attendance" : "closed-owned-currently-assigned-sections",
      } }], skipDuplicates: true });
    // The unique actor/request key handles concurrent retries across processes.
    const event = await tx.auditEntry.findUniqueOrThrow({ where: { actorId_exportRequestId: { actorId: actor.id, exportRequestId: input.requestId } }, select: { id: true, timestamp: true, reportId: true, details: true } });
    const details = event.details as { requestHash?: string };
    if (event.reportId !== input.reportId || details.requestHash !== requestHash) throw new HttpError(409, "Export requestId was already used with different report filters or role");
    return { status: inserted.count ? 201 : 200, body: { outcome: "client-report-received", eventId: event.id, receivedAt: event.timestamp, replayed: !inserted.count } };
  });
}
