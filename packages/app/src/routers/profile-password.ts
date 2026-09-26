import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options?: { N?: number; r?: number; p?: number },
) => Promise<Buffer>;

/** Minimum password length for local accounts (mirrors auth-password). */
export const PROFILE_MIN_PASSWORD_LENGTH = 12;

interface ParsedHash {
  salt: string;
  hash: string;
  params: { N: number; r: number; p: number };
}

function parseStoredHash(stored: string): ParsedHash | null {
  const match =
    /^scrypt\$(?<n>\d+)\$(?<r>\d+)\$(?<p>\d+)\$(?<salt>[A-Za-z0-9_-]+)\$(?<hash>[A-Za-z0-9_-]+)$/u.exec(
      stored,
    );
  if (!match?.groups) {
    return null;
  }
  const { n, r, p, salt, hash } = match.groups;
  if (!salt || !hash) {
    return null;
  }
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  return Number.isNaN(params.N) || Number.isNaN(params.r) || Number.isNaN(params.p)
    ? null
    : { salt, hash, params };
}

/** Hash a password with scrypt (N=16384, r=8, p=1) and a random salt. */
export async function hashProfilePassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64, { N: 16_384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

/** Verify a password against a stored scrypt hash. */
export async function verifyProfilePassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseStoredHash(stored);
  if (!parsed) {
    return false;
  }
  const expected = Buffer.from(parsed.hash, "base64url");
  const derived = await scryptAsync(
    password,
    Buffer.from(parsed.salt, "base64url"),
    expected.length,
    parsed.params,
  );
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
