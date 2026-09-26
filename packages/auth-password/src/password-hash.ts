/* oxlint-disable eslint/max-statements -- scrypt parsing is inherently multi-step */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options?: { N?: number; r?: number; p?: number; maxmemBytes?: number },
) => Promise<Buffer>;

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

/** Minimum password length for local accounts. */
export const MIN_PASSWORD_LENGTH = 12;

/** Check whether a password meets the minimum length policy. */
export function isValidPassword(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH;
}

/** Hash a password with scrypt (N=16384, r=8, p=1) and a random salt. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await scryptAsync(password, salt, KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

interface ParsedHash {
  salt: string;
  hash: string;
  params: { N: number; r: number; p: number };
}

function parseStoredHash(stored: string): ParsedHash | null {
  const re =
    /^scrypt\$(?<n>\d+)\$(?<r>\d+)\$(?<p>\d+)\$(?<salt>[A-Za-z0-9_-]+)\$(?<hash>[A-Za-z0-9_-]+)$/u;
  const match = re.exec(stored);
  if (!match?.groups) {
    return null;
  }
  const salt = match.groups["salt"];
  const hash = match.groups["hash"];
  if (!salt || !hash) {
    return null;
  }
  const n = Number(match.groups["n"]);
  const r = Number(match.groups["r"]);
  const p = Number(match.groups["p"]);
  if (Number.isNaN(n) || Number.isNaN(r) || Number.isNaN(p)) {
    return null;
  }
  return { salt, hash, params: { N: n, r, p } };
}

/** Verify a password against a stored scrypt hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseStoredHash(stored);
  if (!parsed) {
    return false;
  }
  const saltBuf = Buffer.from(parsed.salt, "base64url");
  const expected = Buffer.from(parsed.hash, "base64url");
  const derived = await scryptAsync(password, saltBuf, expected.length, parsed.params);
  if (derived.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(derived, expected);
}
