import { randomBytes } from "node:crypto";

/** Generate a sortable, collision-resistant ULID. */
export function ulid(): string {
  return encodeTime(Date.now()) + encodeRandom(randomBytes(10));
}

/** Convert a name to a URL-safe slug of at most 63 characters. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, 63);
}

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
    const drained = drainGroups(buffer, bits);
    out += drained.text;
    bits = drained.bits;
  }
  return out + (bits > 0 ? CROCKFORD.charAt((buffer << (5 - bits)) & 31) : "");
}

/** Every complete 5-bit group held in the low `bits` bits of `buffer`, and the bits left over. */
function drainGroups(buffer: number, bits: number): { text: string; bits: number } {
  let text = "";
  let left = bits;
  while (left >= 5) {
    text += CROCKFORD.charAt((buffer >>> (left - 5)) & 31);
    left -= 5;
  }
  return { text, bits: left };
}
/* eslint-enable no-bitwise, no-non-null-assertion */
