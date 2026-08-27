import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Compute the hex-encoded SHA-256 digest of a string.
 *
 * @param value - Input string to hash.
 * @returns The hex SHA-256 digest.
 */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Compute the hex-encoded HMAC-SHA256 signature of a value.
 *
 * @param secret - HMAC key.
 * @param value - Value to sign.
 * @returns The hex HMAC-SHA256 digest.
 */
export function hmacSha256(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

/**
 * Generate a random token with a given prefix and its hashed form.
 *
 * @param prefix - Leading text prepended to the random token value.
 * @returns An object with the plaintext `value` and its SHA-256 `hash`.
 */
export function randomToken(prefix: string): { value: string; hash: string } {
  const value = `${prefix}${randomBytes(24).toString("base64url")}`;
  return { value, hash: sha256(value) };
}

/**
 * Compare two strings in constant time to avoid timing attacks.
 *
 * @param a - First string.
 * @param b - Second string.
 * @returns True if the strings are equal in both length and content.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
