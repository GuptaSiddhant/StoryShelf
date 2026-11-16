import { randomBytes } from "node:crypto";

/** The random part of a ULID is 80 bits. */
const RANDOM_BITS = 80n;
const RANDOM_MAX = 2n ** RANDOM_BITS - 1n;

/** Time and random part of the last id this process made, for the monotonic rule. */
let lastTime = -1;
let lastRandom = 0n;

/**
 * Generate a sortable, collision-resistant ULID. Monotonic within a process:
 * ids made in the same millisecond (or after the clock stepped back) keep the
 * last timestamp and increment its random part, so id order is creation order.
 * Throws if 2^80 ids are made in one millisecond.
 */
export function ulid(): string {
  const now = Date.now();
  if (now > lastTime) {
    lastTime = now;
    lastRandom = BigInt(`0x${randomBytes(10).toString("hex")}`);
  } else if (lastRandom === RANDOM_MAX) {
    throw new Error("ULID random part overflowed within one millisecond");
  } else {
    lastRandom += 1n;
  }
  return encodeTime(lastTime) + encodeRandom(randomPartBytes(lastRandom));
}

function randomPartBytes(value: bigint): Buffer {
  return Buffer.from(value.toString(16).padStart(20, "0"), "hex");
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
