import { randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(time: number): string {
  let out = "";
  let remaining = time;
  for (let i = 9; i >= 0; i -= 1) {
    const mod = remaining % 32;
    // eslint-disable-next-line no-non-null-assertion -- index is within CROCKFORD length
    out = CROCKFORD[mod]! + out;
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
      out += CROCKFORD[(buffer >>> (bits - 5)) & 31]!;
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += CROCKFORD[(buffer << (5 - bits)) & 31]!;
  }
  return out;
}
/* eslint-enable no-bitwise, no-non-null-assertion */

/**
 * Generate a new sortable, collision-resistant ULID.
 *
 * @returns A 26-character ULID string.
 */
export function ulid(): string {
  return encodeTime(Date.now()) + encodeRandom(randomBytes(10));
}

/**
 * Convert a string into a URL-safe slug, capped at 63 characters.
 *
 * @param value - Raw string to slugify.
 * @returns The lowercased, hyphen-separated slug.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, 63);
}
