import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** Current server secret plus the one it replaced, kept only to decrypt older rows. */
export interface SecretKeys {
  current: string;
  previous?: string;
}

/** What credential models accept: a bare secret, a rotation pair, or nothing. */
export type SecretInput = string | SecretKeys | undefined;

/** Which key decrypted a payload. */
export type KeyUsed = "current" | "previous";

/** Thrown when a stored credential cannot be decrypted with any configured key. */
export class UndecryptableCredentialError extends Error {
  constructor(cause?: unknown) {
    super(
      "Stored credential cannot be decrypted: check that SECRET (and SECRET_PREVIOUS after a rotation) match the key it was encrypted with",
      { cause },
    );
    this.name = "UndecryptableCredentialError";
  }
}

function currentOf(secret: SecretInput): string | undefined {
  return typeof secret === "object" ? secret.current : secret;
}

/**
 * Encrypt a plaintext secret for storage.
 *
 * Format: `base64url(iv):base64url(authTag):base64url(ciphertext)` (12B IV).
 * Uses `secret` from `ShelfConfig.secret` — throws if missing so misconfiguration
 * fails loudly like `scratchDir` does in `capture/orchestrator.ts`.
 */
export function encrypt(input: SecretInput, plaintext: string): string {
  const secret = currentOf(input);
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
 * Decrypt a value produced by {@link encrypt}, trying the current key first and
 * then the previous one (the rotation fallback).
 *
 * @param input - Server secret, or the current/previous pair during a rotation.
 * @param ciphertext - Encrypted payload in `iv:tag:ciphertext` (base64url) format.
 * @returns The original plaintext secret.
 * @throws If no secret is configured, the payload is malformed, or no key decrypts it.
 */
export function decrypt(input: SecretInput, ciphertext: string): string {
  return decryptWithKey(input, ciphertext).plaintext;
}

/** Like {@link decrypt}, also reporting which key matched. */
export function decryptWithKey(
  input: SecretInput,
  ciphertext: string,
): { plaintext: string; keyUsed: KeyUsed } {
  const current = currentOf(input);
  if (!current) {
    throw new Error("Cannot decrypt: ShelfConfig.secret is not configured");
  }
  try {
    return { plaintext: decryptWith(current, ciphertext), keyUsed: "current" };
  } catch (error) {
    const previous = typeof input === "object" ? input.previous : undefined;
    if (!previous) {
      throw error;
    }
    try {
      return { plaintext: decryptWith(previous, ciphertext), keyUsed: "previous" };
    } catch {
      throw error;
    }
  }
}

/**
 * Decrypt a stored credential, mapping any key mismatch or corruption to
 * {@link UndecryptableCredentialError} so callers can fail loudly with a
 * rotation hint. A missing secret keeps its own configuration error.
 */
export function decryptCredential(input: SecretInput, ciphertext: string): string {
  if (!currentOf(input)) {
    return decrypt(input, ciphertext);
  }
  try {
    return decrypt(input, ciphertext);
  } catch (error) {
    throw new UndecryptableCredentialError(error);
  }
}

function decryptWith(secret: string, ciphertext: string): string {
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

/**
 * Derive a 32-byte AES-256 key from the server secret.
 *
 * Reuses the existing `sha256` pattern (`utils/hash.ts`) so key derivation
 * is consistent with token hashing and session HMAC.
 */
function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}
