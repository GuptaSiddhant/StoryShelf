/**
 * Signed Storybook tokens (ADR 0007, decision 5): the single owner of everything about the path
 * prefix of the URL a remote browser opens to read one build's published Storybook, `/_s/<token>/`:
 * the prefix, the token shape, the derived signing key, signing, verification and the lifetime
 * rules. Stateless: `base64url("<projectId>:<buildId>:<exp>")`, a dot, and the base64url
 * HMAC-SHA-256 of that first part. Imported through `@storyshelf/core/utils`.
 */
import { createHmac } from "node:crypto";
import type { SecretInput } from "./encrypt.ts";
import { timingSafeEqualString } from "./hash.ts";

/** The path prefix every signed Storybook URL starts with; `/_/` is the unrelated short link. */
export const STORYBOOK_TOKEN_PREFIX = "/_s/";
/** Regex source of a token, shared by the shape check and the log redaction. */
export const STORYBOOK_TOKEN_SOURCE = "[A-Za-z0-9_-]{8,200}\\.[A-Za-z0-9_-]{43}";

/** Floor of a derived lifetime, in seconds (2 hours). */
export const DEFAULT_STORYBOOK_URL_TTL = 7200;
/** Shortest lifetime a token may be minted with (a render needs at least this). */
export const MIN_STORYBOOK_URL_TTL = 60;
/** Ceiling of a derived lifetime and the longest accepted: a token claiming more is refused, whoever signed it. */
export const MAX_STORYBOOK_URL_TTL = 86_400;
/** Slack added to a render budget when deriving a lifetime (queue wait, retries, clock skew). */
export const STORYBOOK_URL_TTL_GRACE = 300;

/** Domain separation: the signing key is derived from the secret with this context, nothing else uses it. */
const KEY_CONTEXT = "storyshelf/storybook-url/v1";
const TOKEN_SHAPE = new RegExp(`^${STORYBOOK_TOKEN_SOURCE}$`, "u");
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
  /** The server secret (a rotation pair signs with its current key); throws when empty. */
  secret: SecretInput;
  projectId: string;
  buildId: string;
  /** Lifetime in seconds; defaults to {@link DEFAULT_STORYBOOK_URL_TTL}. See {@link storybookUrlTtl}. */
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
  const secret = currentSecret(input.secret);
  const expiresAt = Math.floor((input.now ?? Date.now()) / 1000) + ttl;
  const claims = `${input.projectId}:${input.buildId}:${expiresAt}`;
  if (!CLAIMS_SHAPE.test(claims)) {
    throw new Error("Cannot sign a Storybook URL: unexpected project or build id");
  }
  const payload = Buffer.from(claims, "utf8").toString("base64url");
  return `${payload}.${signature(secret, payload)}`;
}

/**
 * Check a token against the current secret and, during a rotation, the previous one. The signature
 * is checked (in constant time) before the payload is read, and every failure looks the same to
 * the caller except for `reason`, which is for the server's own log.
 */
export function verifyStorybookToken(
  token: unknown,
  secret: SecretInput,
  now: number = Date.now(),
): StorybookTokenResult {
  if (typeof token !== "string" || !TOKEN_SHAPE.test(token)) {
    return { ok: false, reason: "malformed" };
  }
  const [payload = "", given = ""] = token.split(".");
  const signed = secretsOf(secret).some((key) =>
    timingSafeEqualString(signature(key, payload), given),
  );
  if (!signed) {
    return { ok: false, reason: "signature" };
  }
  return claimsOf(payload, Math.floor(now / 1000));
}

/** The path of a token's root: `/_s/<token>/`. */
export function storybookTokenPath(token: string): string {
  return `${STORYBOOK_TOKEN_PREFIX}${token}/`;
}

/**
 * The lifetime of a render's tokens: the project's override when it has one, otherwise the render
 * budget (seconds) plus {@link STORYBOOK_URL_TTL_GRACE}, never below {@link DEFAULT_STORYBOOK_URL_TTL}
 * and never above {@link MAX_STORYBOOK_URL_TTL}. A pass cannot outlive its budget, so a token
 * derived from it lasts as long as the pass that carries it.
 */
export function storybookUrlTtl(input: {
  override?: number | null | undefined;
  budgetMs: number;
}): number {
  if (input.override !== undefined && input.override !== null) {
    return input.override;
  }
  const derived = Math.ceil(input.budgetMs / 1000) + STORYBOOK_URL_TTL_GRACE;
  return Math.min(MAX_STORYBOOK_URL_TTL, Math.max(DEFAULT_STORYBOOK_URL_TTL, derived));
}

/** Throws unless `seconds` is an integer within the allowed lifetime range. */
export function assertStorybookUrlTtl(seconds: number): void {
  if (
    !Number.isInteger(seconds) ||
    seconds < MIN_STORYBOOK_URL_TTL ||
    seconds > MAX_STORYBOOK_URL_TTL
  ) {
    throw new Error(
      `A Storybook URL lifetime must be a whole number of seconds from ${MIN_STORYBOOK_URL_TTL} to ${MAX_STORYBOOK_URL_TTL}, got ${String(seconds)}`,
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

/** The key tokens are signed with; throws when none is configured. */
function currentSecret(secret: SecretInput): string {
  const current = typeof secret === "object" ? secret.current : secret;
  if (!current) {
    throw new Error("Cannot sign a Storybook URL: ShelfConfig.secret is not configured");
  }
  return current;
}

/** Every key a token may verify with: the current secret and, during a rotation, the previous one. */
function secretsOf(secret: SecretInput): string[] {
  const keys = typeof secret === "object" ? [secret.current, secret.previous] : [secret];
  return keys.filter((key): key is string => key !== undefined && key !== "");
}

function signature(secret: string, payload: string): string {
  const key = createHmac("sha256", secret).update(KEY_CONTEXT).digest();
  return createHmac("sha256", key).update(payload).digest("base64url");
}
