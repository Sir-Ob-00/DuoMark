import express from "express";
import { prisma } from "./db/prisma.js";
import { authRouter } from "./routes/auth.routes.js";
import { browserSecurity } from "./middleware/auth.js";
import type { ErrorRequestHandler } from "express";
import { studentRouter } from "./routes/student.routes.js";
import { lecturerRouter } from "./routes/lecturer.routes.js";
import { courseRouter } from "./routes/course.routes.js";
import { classSectionRouter } from "./routes/class-section.routes.js";
import { lecturerClassRouter } from "./routes/lecturer-class.routes.js";
import { terminalRouter } from "./routes/terminal.routes.js";
import { attendanceSessionRouter } from "./routes/attendance-session.routes.js";
import { adminSessionRouter } from "./routes/admin-session.routes.js";
import { publicTerminalRouter } from "./routes/public-terminal.routes.js";
import { terminalCheckInRouter } from "./routes/terminal-check-in.routes.js";
import { attendanceReadRouter } from "./routes/attendance-read.routes.js";
import { attendanceReportRouter } from "./routes/attendance-report.routes.js";
import { auditRouter } from "./routes/audit.routes.js";
import { eventsRouter } from "./routes/events.routes.js";
import { reportExportRouter } from "./routes/report-export.routes.js";
import { overviewRouter } from "./routes/overview.routes.js";
import { HttpError } from "./utils/http-error.js";
import { Prisma } from "./generated/prisma/client.js";

export const app = express();

app.disable("x-powered-by");
// Set only to the exact trusted proxy addresses/subnets used by the deployment.
if (process.env.TRUST_PROXY) app.set("trust proxy", process.env.TRUST_PROXY.split(",").map(value => value.trim()));
// This exact device-authenticated write route has its own credential boundary;
// mount before cookie-based browser CSRF handling. Public reads stay separate.
app.use("/api/v1/terminals", terminalCheckInRouter);
app.use("/api", browserSecurity);
app.use(express.json({ limit: "16kb" }));
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/events", eventsRouter);
app.use("/api/v1/reports/exports", reportExportRouter);
app.use("/api/v1", overviewRouter);
app.use("/api/v1/admin/students", studentRouter);
app.use("/api/v1/admin/lecturers", lecturerRouter);
app.use("/api/v1/courses", courseRouter);
app.use("/api/v1/class-sections", classSectionRouter);
app.use("/api/v1/lecturer", lecturerClassRouter);
app.use("/api/v1/admin/terminals", terminalRouter);
app.use("/api/v1/lecturer/sessions", attendanceSessionRouter);
app.use("/api/v1/admin/sessions", adminSessionRouter);
app.use("/api/v1/terminals", publicTerminalRouter);
app.use("/api/v1", attendanceReadRouter);
app.use("/api/v1", attendanceReportRouter);
app.use("/api/v1/admin/audit-events", auditRouter);

app.get("/health", async (_request, response) => {
  try {
    const courseCount = await prisma.course.count();
    response.json({ status: "ok", database: "connected", courseCount });
  } catch {
    response.status(503).json({ status: "unavailable", database: "error" });
  }
});

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof HttpError) { response.status(error.status).json({ error: error.message }); return; }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && error.meta?.modelName === "Student") {
    response.status(409).json({ error: "Student index number is already in use" }); return;
  }
  // Do not log request bodies, cookies, or database errors containing secret values.
  const status = error?.status === 400 ? 400 : error?.status === 413 ? 413 : 500;
  response.status(status).json({ error: status === 400 ? "Invalid JSON" : status === 413 ? "Request too large" : "Internal server error" });
};
app.use(errorHandler);
