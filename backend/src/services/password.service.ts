import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error); else resolve(key);
    });
  });
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${(await derive(password, salt)).toString("hex")}`;
}
// A missing account still performs the same expensive password derivation.
const dummy = `scrypt$${"0".repeat(32)}$${"0".repeat(128)}`;
export async function verifyPassword(password: string, hash = dummy) {
  const [algorithm, salt, expected] = hash.split("$");
  if (algorithm !== "scrypt" || !/^[a-f0-9]{32}$/.test(salt ?? "") || !/^[a-f0-9]{128}$/.test(expected ?? "")) {
    await derive(password, "0".repeat(32));
    return false;
  }
  return timingSafeEqual(await derive(password, salt), Buffer.from(expected, "hex"));
}
