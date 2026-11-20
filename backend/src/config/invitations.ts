import { HttpError } from "../utils/http-error.js";

export const invitationAvailability = { message: "Lecturer invitations unavailable: configure MAIL_TRANSPORT and FRONTEND_BASE_URL (see backend README)" };
export function invitationConfig() {
  const raw = process.env.FRONTEND_BASE_URL;
  const transport = process.env.MAIL_TRANSPORT;
  if (!raw || !["smtp", "development-inbox"].includes(transport ?? "")) throw new HttpError(503, invitationAvailability.message);
  let base: URL;
  try { base = new URL(raw); } catch { throw new HttpError(503, "FRONTEND_BASE_URL must be an absolute frontend origin"); }
  if (base.username || base.password || base.pathname !== "/" || base.search || base.hash ||
      (base.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname)))) throw new HttpError(503, "Configure a trusted HTTPS FRONTEND_BASE_URL (local HTTP is development-only)");
  if (transport === "development-inbox" && !["development", "test"].includes(process.env.NODE_ENV ?? "")) throw new HttpError(503, "Development inbox is unavailable outside development/test");
  if (transport === "smtp" && (!process.env.SMTP_HOST || !process.env.MAIL_FROM || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD)) throw new HttpError(503, "Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and MAIL_FROM");
  return { frontend: base.origin, transport: transport as "smtp" | "development-inbox" };
}
