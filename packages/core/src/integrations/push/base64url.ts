import { Buffer } from "node:buffer";

/** Encode bytes as unpadded base64url. */
export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/** Decode base64url (padding optional). */
export function fromBase64Url(text: string): Buffer {
  return Buffer.from(text, "base64url");
}
