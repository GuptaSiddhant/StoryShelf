import { randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(time: number): string {
  let out = "";
  for (let i = 9; i >= 0; i -= 1) {
    const mod = time % 32;
    out = CROCKFORD[mod]! + out;
    time = (time - mod) / 32;
  }
  return out;
}

function encodeRandom(bytes: Buffer): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(buffer >>> (bits - 5)) & 31]!;
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += CROCKFORD[(buffer << (5 - bits)) & 31]!;
  }
  return out;
}

export function ulid(): string {
  return encodeTime(Date.now()) + encodeRandom(randomBytes(10));
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 63);
}
