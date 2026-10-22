/**
 * Signed Storybook tokens (ADR 0007, decision 5): the path prefix of the URL a remote browser opens
 * to read one build's published Storybook. Stateless: `base64url("<projectId>:<buildId>:<exp>")`,
 * a dot, and the base64url HMAC-SHA-256 of that first part. Imported through `@storyshelf/core/utils`.
 */
import { createHmac } from "node:crypto";
import { timingSafeEqualString } from "./hash.ts";

/** Default lifetime of a token, in seconds. */
export const DEFAULT_STORYBOOK_URL_TTL = 7200;
/** Shortest lifetime a token may be minted with (a render needs at least this). */
export const MIN_STORYBOOK_URL_TTL = 60;
/** Longest lifetime, minted or accepted: a token claiming more is refused, whoever signed it. */
export const MAX_STORYBOOK_URL_TTL = 86_400;

/** Domain separation: the signing key is derived from the secret with this context, nothing else uses it. */
const KEY_CONTEXT = "storyshelf/storybook-url/v1";
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{8,200}\.[A-Za-z0-9_-]{43}$/u;
const CLAIMS_SHAPE = /^([A-Za-z0-9_-]{1,64}):([A-Za-z0-9_-]{1,64}):(\d{1,12})$/u;

/** What a valid token grants: read-only access to one build's static files until `expiresAt`. */
export interface StorybookTokenClaims {
  projectId: string;
  buildId: string;
  /** Unix seconds. */
  expiresAt: number;
}

/** Inputs for {@link signStorybookToken}. */
export interface SignStorybookTokenInput {
  /** The server `secret`; throws when empty. */
  secret: string;
  projectId: string;
  buildId: string;
  /** Lifetime in seconds; defaults to {@link DEFAULT_STORYBOOK_URL_TTL}. */
  ttlSeconds?: number | undefined;
  /** Clock override for tests (ms). */
  now?: number | undefined;
}

/** Why a token was refused (kept apart from the response, which is the same for all). */
export type StorybookTokenFailure = "malformed" | "signature" | "expired" | "scope";

/** The outcome of {@link verifyStorybookToken}. */
export type StorybookTokenResult =
  | { ok: true; claims: StorybookTokenClaims }
  | { ok: false; reason: StorybookTokenFailure };

/** Sign a token for one build. Throws on an empty secret, bad ids or a lifetime out of range. */
export function signStorybookToken(input: SignStorybookTokenInput): string {
  const ttl = input.ttlSeconds ?? DEFAULT_STORYBOOK_URL_TTL;
  assertStorybookUrlTtl(ttl);
  if (!input.secret) {
    throw new Error("Cannot sign a Storybook URL: ShelfConfig.secret is not configured");
  }
  const expiresAt = Math.floor((input.now ?? Date.now()) / 1000) + ttl;
  const claims = `${input.projectId}:${input.buildId}:${expiresAt}`;
  if (!CLAIMS_SHAPE.test(claims)) {
    throw new Error("Cannot sign a Storybook URL: unexpected project or build id");
  }
  const payload = Buffer.from(claims, "utf8").toString("base64url");
  return `${payload}.${signature(input.secret, payload)}`;
}

/**
 * Check a token against the current secret and, during a rotation, the previous one. The signature
 * is checked (in constant time) before the payload is read, and every failure looks the same to
 * the caller except for `reason`, which is for the server's own log.
 */
export function verifyStorybookToken(
  token: unknown,
  secrets: readonly string[],
  now: number = Date.now(),
): StorybookTokenResult {
  if (typeof token !== "string" || !TOKEN_SHAPE.test(token)) {
    return { ok: false, reason: "malformed" };
  }
  const [payload = "", given = ""] = token.split(".");
  const signed = secrets.some(
    (secret) => secret !== "" && timingSafeEqualString(signature(secret, payload), given),
  );
  if (!signed) {
    return { ok: false, reason: "signature" };
  }
  return claimsOf(payload, Math.floor(now / 1000));
}

/** Throws unless `seconds` is an integer within the allowed lifetime range. */
export function assertStorybookUrlTtl(seconds: number): void {
  if (
    !Number.isInteger(seconds) ||
    seconds < MIN_STORYBOOK_URL_TTL ||
    seconds > MAX_STORYBOOK_URL_TTL
  ) {
    throw new Error(
      `storybookUrlTtl must be a whole number of seconds from ${MIN_STORYBOOK_URL_TTL} to ${MAX_STORYBOOK_URL_TTL}, got ${String(seconds)}`,
    );
  }
}

function claimsOf(payload: string, nowSeconds: number): StorybookTokenResult {
  const match = CLAIMS_SHAPE.exec(Buffer.from(payload, "base64url").toString("utf8"));
  if (!match) {
    return { ok: false, reason: "malformed" };
  }
  const [, projectId = "", buildId = "", exp = ""] = match;
  const expiresAt = Number(exp);
  if (expiresAt <= nowSeconds) {
    return { ok: false, reason: "expired" };
  }
  if (expiresAt > nowSeconds + MAX_STORYBOOK_URL_TTL) {
    return { ok: false, reason: "scope" };
  }
  return { ok: true, claims: { projectId, buildId, expiresAt } };
}

function signature(secret: string, payload: string): string {
  const key = createHmac("sha256", secret).update(KEY_CONTEXT).digest();
  return createHmac("sha256", key).update(payload).digest("base64url");
}
