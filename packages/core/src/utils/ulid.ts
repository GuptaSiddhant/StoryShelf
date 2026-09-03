import { randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(time: number): string {
  let out = "";
  let remaining = time;
  for (let i = 9; i >= 0; i -= 1) {
    const mod = remaining % 32;
    out = CROCKFORD.charAt(mod) + out;
    remaining = (remaining - mod) / 32;
  }
  return out;
}

/* eslint-disable no-bitwise, no-non-null-assertion -- ULID encoding is inherently bitwise. */
function encodeRandom(bytes: Buffer): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD.charAt((buffer >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += CROCKFORD.charAt((buffer << (5 - bits)) & 31);
  }
  return out;
}
/* eslint-enable no-bitwise, no-non-null-assertion */

export function ulid(): string {
  return encodeTime(Date.now()) + encodeRandom(randomBytes(10));
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, 63);
}
