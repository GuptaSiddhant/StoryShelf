import { Buffer } from "node:buffer";
import { createCipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto";
import type { ECDH } from "node:crypto";
import { fromBase64Url } from "./base64url.ts";

/** One record carries the whole message; the largest the services accept is 4096 bytes. */
const RECORD_SIZE = 4096;
/** Header (86) plus the delimiter (1) plus the GCM tag (16). */
const OVERHEAD = 86 + 1 + 16;
/** The longest plaintext that fits one record. */
export const MAX_PLAINTEXT_BYTES = RECORD_SIZE - OVERHEAD;

/** Test seams: fixed salt and sender key pair (RFC 8291, appendix A). */
export interface EncryptOverrides {
  salt?: Uint8Array;
  senderPrivateKey?: string;
}

/**
 * Encrypt a message for one device with `aes128gcm` (RFC 8188 as profiled by RFC 8291).
 *
 * @param plaintext - Message bytes (at most {@link MAX_PLAINTEXT_BYTES}).
 * @param p256dh - The device's public key, base64url.
 * @param auth - The device's auth secret, base64url.
 * @returns The request body.
 */
export function encryptPayload(
  plaintext: Uint8Array,
  p256dh: string,
  auth: string,
  overrides: EncryptOverrides = {},
): Buffer {
  if (plaintext.length > MAX_PLAINTEXT_BYTES) {
    throw new Error(`push payload exceeds ${String(MAX_PLAINTEXT_BYTES)} bytes`);
  }
  const device = fromBase64Url(p256dh);
  const sender = senderKeys(overrides.senderPrivateKey);
  const salt = Buffer.from(overrides.salt ?? randomBytes(16));
  const { cek, nonce } = deriveKeys(sender, device, fromBase64Url(auth), salt);
  const body = seal(cek, nonce, plaintext);
  return Buffer.concat([recordHeader(salt, sender.getPublicKey()), body]);
}

function senderKeys(privateKey: string | undefined): ECDH {
  const sender = createECDH("prime256v1");
  if (privateKey) {
    sender.setPrivateKey(fromBase64Url(privateKey));
  } else {
    sender.generateKeys();
  }
  return sender;
}

/** The content-encryption key and nonce of RFC 8291, section 3.4 and RFC 8188, section 2.2. */
function deriveKeys(
  sender: ECDH,
  device: Buffer,
  auth: Buffer,
  salt: Buffer,
): { cek: Buffer; nonce: Buffer } {
  const shared = sender.computeSecret(device);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), device, sender.getPublicKey()]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, auth, keyInfo, 32));
  const cekInfo = Buffer.from("Content-Encoding: aes128gcm\0");
  const nonceInfo = Buffer.from("Content-Encoding: nonce\0");
  return {
    cek: Buffer.from(hkdfSync("sha256", ikm, salt, cekInfo, 16)),
    nonce: Buffer.from(hkdfSync("sha256", ikm, salt, nonceInfo, 12)),
  };
}

/** One AES-128-GCM record: the message, the last-record delimiter `0x02`, then the tag. */
function seal(cek: Buffer, nonce: Buffer, plaintext: Uint8Array): Buffer {
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const record = Buffer.concat([plaintext, Buffer.from([2])]);
  return Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);
}

/** RFC 8188 header: salt, record size, key id length and the sender's public key as key id. */
function recordHeader(salt: Buffer, senderPublic: Buffer): Buffer {
  const fixed = Buffer.alloc(21);
  salt.copy(fixed, 0);
  fixed.writeUInt32BE(RECORD_SIZE, 16);
  fixed.writeUInt8(senderPublic.length, 20);
  return Buffer.concat([fixed, senderPublic]);
}
