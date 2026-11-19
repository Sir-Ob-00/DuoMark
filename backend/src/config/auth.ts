import "dotenv/config";

const production = process.env.NODE_ENV === "production";
const origins = (process.env.FRONTEND_ORIGINS ?? (production ? "" : "http://localhost:5173"))
  .split(",").map(value => value.trim()).filter(Boolean);
if (!origins.length || origins.some(origin => new URL(origin).origin !== origin)) {
  throw new Error("FRONTEND_ORIGINS must contain explicit origins.");
}
const sameSite = process.env.SESSION_SAME_SITE ?? "lax";
if (!["lax", "strict", "none"].includes(sameSite)) throw new Error("Invalid SESSION_SAME_SITE.");
const secure = production || process.env.SESSION_SECURE === "true";
if (sameSite === "none" && !secure) throw new Error("SameSite=None requires SESSION_SECURE=true.");
const ttl = Number(process.env.SESSION_TTL_SECONDS ?? 28800);
if (!Number.isSafeInteger(ttl) || ttl < 60 || ttl > 604800) throw new Error("Invalid SESSION_TTL_SECONDS.");
export const authConfig = {
  origins, ttl, cookieName: secure ? "__Host-duomark_session" : "duomark_session",
  cookie: { httpOnly: true, secure, sameSite: sameSite as "lax" | "strict" | "none", path: "/" },
};
