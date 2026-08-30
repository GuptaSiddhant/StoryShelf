import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Derive a 32-byte AES-256 key from the server secret.
 *
 * Reuses the existing `sha256` pattern (`utils/hash.ts`) so key derivation
 * is consistent with token hashing and session HMAC.
 */
function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

/**
 * Encrypt a plaintext secret for storage.
 *
 * Format: `base64url(iv):base64url(authTag):base64url(ciphertext)` (12B IV).
 * Uses `secret` from `ShelfConfig.secret` — throws if missing so misconfiguration
 * fails loudly like `scratchDir` does in `capture/orchestrator.ts`.
 */
export function encrypt(secret: string | undefined, plaintext: string): string {
  if (!secret) {
    throw new Error("Cannot encrypt: ShelfConfig.secret is not configured");
  }
  const key = deriveKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}:${tag.toString("base64url")}:${enc.toString("base64url")}`;
}

/**
 * Decrypt a value produced by `encrypt`.
 */
export function decrypt(secret: string | undefined, ciphertext: string): string {
  if (!secret) {
    throw new Error("Cannot decrypt: ShelfConfig.secret is not configured");
  }
  const [ivB64, tagB64, encB64] = ciphertext.split(":");
  if (!ivB64 || !tagB64 || !encB64) {
    throw new Error("Invalid encrypted payload format");
  }
  const key = deriveKey(secret);
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const enc = Buffer.from(encB64, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}
