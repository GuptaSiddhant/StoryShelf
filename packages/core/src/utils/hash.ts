import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Hash a value with SHA-256, returning lowercase hex. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Sign a value with HMAC-SHA-256, returning lowercase hex. */
export function hmacSha256(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

/** Generate a prefixed random token and its SHA-256 hash. */
export function randomToken(prefix: string): { value: string; hash: string } {
  const value = `${prefix}${randomBytes(24).toString("base64url")}`;
  return { value, hash: sha256(value) };
}

/** Compare two strings in constant time to avoid timing leaks. */
export function timingSafeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
