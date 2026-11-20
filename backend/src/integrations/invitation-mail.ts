import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { invitationConfig } from "../config/invitations.js";

type Mail = { id: string; to: string; activationLink: string; expiresAt: Date };
// A deliberately separate, loopback-only development mail inbox. Message
// bodies are email delivery content, never exposed by the application API.
const inbox: Mail[] = [];
export async function sendInvitationMail(to: string, activationLink: string, expiresAt: Date) {
  const config = invitationConfig();
  if (config.transport === "development-inbox") {
    inbox.push({ id: randomUUID(), to, activationLink, expiresAt });
    if (inbox.length > 50) inbox.shift();
    return;
  }
  const { default: nodemailer } = await import("nodemailer");
  const port = Number(process.env.SMTP_PORT ?? 465);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid SMTP configuration");
  const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port,
    secure: port === 465, requireTLS: port !== 465,
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASSWORD! },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    logger: false, debug: false,
  });
  try {
    const result = await transport.sendMail({ from: process.env.MAIL_FROM!, to, subject: "Activate your DuoMark lecturer account",
      text: `You have been invited to activate your DuoMark lecturer account.\n\nSet your password: ${activationLink}\n\nThis single-use invitation expires at ${expiresAt.toISOString()}. If you did not expect it, ignore this email.` });
    if (!result.accepted.some((recipient: string | { address: string }) => (typeof recipient === "string" ? recipient : recipient.address).toLowerCase() === to.toLowerCase())) throw new Error("Recipient not accepted");
  } finally { transport.close(); }
}
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function createDevelopmentInbox() {
  if (!["development", "test"].includes(process.env.NODE_ENV ?? "") || process.env.MAIL_TRANSPORT !== "development-inbox") throw new Error("Development inbox is disabled");
  return createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
    const host = request.headers.host ?? "";
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) || request.headers.origin || request.method !== "GET" || request.url !== "/") { response.writeHead(403); response.end("Forbidden"); return; }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    const visible = inbox.filter(mail => mail.expiresAt.getTime() > Date.now());
    response.end(`<!doctype html><html><head><title>DuoMark development mail inbox</title><meta name="viewport" content="width=device-width"><style>body{font:16px system-ui;max-width:850px;margin:40px auto;padding:20px}article{border:1px solid #ccc;padding:20px;margin:20px 0}a{color:#086b69}</style></head><body><h1>DuoMark development mail inbox</h1><p>Local test transport only. Refresh to see new messages. Messages disappear when the API restarts.</p>${visible.slice().reverse().map(mail => `<article><h2>Activate your DuoMark lecturer account</h2><p>To: ${escape(mail.to)}</p><p>Expires: ${mail.expiresAt.toISOString()}</p><a href="${escape(mail.activationLink)}" rel="noreferrer">Set your lecturer password</a></article>`).join("") || "<p>No current messages.</p>"}</body></html>`);
  });
}
