/**
 * Signed Storybook tokens (ADR 0007, decision 5; ADR 0051, decision 4): the single owner of everything
 * about the path prefixes of the URLs that read one build's published Storybook with a token
 * instead of a session, `/_s/<token>/` (capture) and `/_r/<token>/` (read grant):
 * the prefix, the token shape, the derived signing key, signing, verification and the lifetime
 * rules. Stateless: `base64url("<projectId>:<buildId>:<exp>:<purpose>")`, a dot, and the base64url
 * HMAC-SHA-256 of that first part under the purpose's own key. `capture` tokens open `/_s/`, `read`
 * grants (ADR 0051) open `/_r/`; neither opens the other's route. Imported through
 * `@storyshelf/core/utils`.
 */
import { createHmac } from "node:crypto";
import type { SecretInput } from "./encrypt.ts";
import { timingSafeEqualString } from "./hash.ts";

/** The path prefix every signed Storybook URL starts with; `/_/` is the unrelated short link. */
export const STORYBOOK_TOKEN_PREFIX = "/_s/";
/** The path prefix of a read grant (ADR 0051, decision 4): `/_r/<token>/`, never `/_s/`. */
export const STORYBOOK_READ_PREFIX = "/_r/";
/**
 * The path prefix of the exchange on a content host (ADR 0051, decision 5): `/_x/<token>/`. It exists
 * on content hosts only and is never `/_r/` or `/_s/`.
 */
export const STORYBOOK_EXCHANGE_PREFIX = "/_x/";
/**
 * The cookie a content host sets after the exchange (ADR 0051, decision 5). The `__Host-` prefix forces
 * `Secure`, `Path=/` and no `Domain`, so it stays on the one host. Its value is a sealed `cookie`
 * token naming the build and the expiry; the content host checks it on every request.
 */
export const STORYBOOK_GRANT_COOKIE = "__Host-storyshelf-grant";
/** Lifetime of a read grant, in seconds (1 hour); the longest a `read` token may claim. */
export const STORYBOOK_READ_TTL = 3600;
/** Lifetime of an exchange token, in seconds (60); the longest an `exchange` token may claim. */
export const STORYBOOK_EXCHANGE_TTL = 60;
/** Lifetime of the sealed value of a content host's grant cookie, in seconds (1 hour). */
export const STORYBOOK_COOKIE_TTL = 3600;
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

/** Extra time granted per capture of a render pass, in ms; sizes a pass's budget and its slices. */
export const PER_CAPTURE_BUDGET_MS = 15_000;
/** Smallest slice (captures), so a very short project override never renders a page per call. */
export const MIN_CAPTURES_PER_SLICE = 50;
/**
 * Shortest lifetime a project may set as its override (seconds): one minimum slice's budget plus
 * the grace, so a slice never outlives its token. Single owner of the rule; every parser of the
 * override (project API, settings form, page hint) reads it through {@link storybookUrlTtlOverrideError}.
 */
export const MIN_STORYBOOK_URL_TTL_OVERRIDE =
  Math.ceil((MIN_CAPTURES_PER_SLICE * PER_CAPTURE_BUDGET_MS) / 1000) + STORYBOOK_URL_TTL_GRACE;

/**
 * Domain separation: each purpose has its own key, derived from the secret with its own context, so
 * a token minted for one purpose never verifies for the other (ADR 0051, decision 4). The capture
 * context is the one tokens have always used.
 */
const KEY_CONTEXTS: Record<StorybookTokenPurpose, string> = {
  capture: "storyshelf/storybook-url/v1",
  read: "storyshelf/storybook-read/v1",
  exchange: "storyshelf/storybook-exchange/v1",
  cookie: "storyshelf/storybook-cookie/v1",
};

/** Lifetime of a purpose that has a fixed one, and the longest it may claim. */
const PURPOSE_TTL: Partial<Record<StorybookTokenPurpose, number>> = {
  read: STORYBOOK_READ_TTL,
  exchange: STORYBOOK_EXCHANGE_TTL,
  cookie: STORYBOOK_COOKIE_TTL,
};
const TOKEN_SHAPE = new RegExp(`^${STORYBOOK_TOKEN_SOURCE}$`, "u");
const CLAIMS_SHAPE =
  /^([A-Za-z0-9_-]{1,64}):([A-Za-z0-9_-]{1,64}):(\d{1,12})(?::(capture|read|exchange|cookie))?$/u;

/**
 * What a token was minted for, signed into it and verified against the route that receives it.
 * `capture` marks the tokens the server mints for a render pass or slice (`storybookUrlSource`); it
 * is the only claim that may opt into browser-private caching of the build's assets, and `/_s/`
 * accepts nothing else. `read` marks a read grant for one viewer's browser (`/_r/`, ADR 0051): one
 * hour at most, signed with its own key, verified with the current secret only. `exchange` (ADR 0051,
 * decision 5) is the 60 second token a portal redirect hands to a content host's `/_x/`; `cookie` is
 * the sealed value of that host's grant cookie, never the exchange token itself. Like `read`, both
 * verify with the current secret only and each has its own key, so no purpose opens another's route.
 */
export type StorybookTokenPurpose = "capture" | "read" | "exchange" | "cookie";

/** What a valid token grants: read-only access to one build's static files until `expiresAt`. */
export interface StorybookTokenClaims {
  projectId: string;
  buildId: string;
  /** Unix seconds. */
  expiresAt: number;
  /** What the token was minted for; a legacy token minted with none is never accepted. */
  purpose: StorybookTokenPurpose;
}

/** Inputs for {@link signStorybookToken}. */
export interface SignStorybookTokenInput {
  /** The server secret (a rotation pair signs with its current key); throws when empty. */
  secret: SecretInput;
  projectId: string;
  buildId: string;
  /**
   * Lifetime in seconds; defaults to {@link DEFAULT_STORYBOOK_URL_TTL} for a capture token (see
   * {@link storybookUrlTtl}) and {@link STORYBOOK_READ_TTL} for a read grant, which may not claim more.
   */
  ttlSeconds?: number | undefined;
  /** What the token is for. Signed into the token and into its key. */
  purpose: StorybookTokenPurpose;
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
  const { purpose } = input;
  const ttl = lifetimeOf(input);
  const secret = currentSecret(input.secret);
  const expiresAt = Math.floor((input.now ?? Date.now()) / 1000) + ttl;
  const claims = `${input.projectId}:${input.buildId}:${expiresAt}:${purpose}`;
  if (!CLAIMS_SHAPE.test(claims)) {
    throw new Error("Cannot sign a Storybook URL: unexpected project or build id");
  }
  const payload = Buffer.from(claims, "utf8").toString("base64url");
  return `${payload}.${signature(secret, purpose, payload)}`;
}

/** The lifetime a token is minted with, checked against the range and the purpose's own ceiling. */
function lifetimeOf(input: SignStorybookTokenInput): number {
  const ttl = input.ttlSeconds ?? PURPOSE_TTL[input.purpose] ?? DEFAULT_STORYBOOK_URL_TTL;
  const longest = PURPOSE_TTL[input.purpose];
  if (longest === undefined) {
    assertStorybookUrlTtl(ttl);
  } else if (!Number.isInteger(ttl) || ttl < MIN_STORYBOOK_URL_TTL || ttl > longest) {
    throw new Error(
      `A ${input.purpose} token lasts at most ${String(longest)} seconds, got ${String(ttl)}`,
    );
  }
  return ttl;
}

/**
 * Check a token for one purpose. A `capture` token verifies against the current secret and, during
 * a rotation, the previous one (ADR 0007); a `read` grant against the current secret only, so a
 * rotation ends every read grant at once (ADR 0051, decision 4). The key is the purpose's own, so a
 * token of the other purpose fails on its signature, and a token with no purpose is refused. The
 * signature is checked (in constant time) before the payload is read, and every failure looks the
 * same to the caller except for `reason`, which is for the server's own log.
 */
export function verifyStorybookToken(
  token: unknown,
  secret: SecretInput,
  purpose: StorybookTokenPurpose,
  now: number = Date.now(),
): StorybookTokenResult {
  if (typeof token !== "string" || !TOKEN_SHAPE.test(token)) {
    return { ok: false, reason: "malformed" };
  }
  const [payload = "", given = ""] = token.split(".");
  const keys = purpose === "capture" ? secretsOf(secret) : currentOnly(secret);
  const signed = keys.some((key) => timingSafeEqualString(signature(key, purpose, payload), given));
  if (!signed) {
    return { ok: false, reason: "signature" };
  }
  return claimsOf(payload, Math.floor(now / 1000), purpose);
}

/** The path of a capture token's root: `/_s/<token>/`. */
export function storybookTokenPath(token: string): string {
  return `${STORYBOOK_TOKEN_PREFIX}${token}/`;
}

/** The path of an exchange token's root on a content host: `/_x/<token>/`. */
export function storybookExchangePath(token: string): string {
  return `${STORYBOOK_EXCHANGE_PREFIX}${token}/`;
}

/** The path of a read grant's root: `/_r/<token>/`. */
export function storybookReadPath(token: string): string {
  return `${STORYBOOK_READ_PREFIX}${token}/`;
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

/** The reason a project's lifetime override is refused, or `undefined` when it is acceptable. */
export function storybookUrlTtlOverrideError(seconds: number): string | undefined {
  if (
    Number.isInteger(seconds) &&
    seconds >= MIN_STORYBOOK_URL_TTL_OVERRIDE &&
    seconds <= MAX_STORYBOOK_URL_TTL
  ) {
    return undefined;
  }
  return `The signed URL lifetime is a whole number of seconds from ${MIN_STORYBOOK_URL_TTL_OVERRIDE} (one slice of ${MIN_CAPTURES_PER_SLICE} captures plus the ${STORYBOOK_URL_TTL_GRACE} s grace) to ${MAX_STORYBOOK_URL_TTL}`;
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

function claimsOf(
  payload: string,
  nowSeconds: number,
  expected: StorybookTokenPurpose,
): StorybookTokenResult {
  const match = CLAIMS_SHAPE.exec(Buffer.from(payload, "base64url").toString("utf8"));
  if (!match) {
    return { ok: false, reason: "malformed" };
  }
  const [, projectId = "", buildId = "", exp = "", purpose] = match;
  const expiresAt = Number(exp);
  const failure = claimsFailure(expiresAt, nowSeconds, purpose === expected, expected);
  return failure
    ? { ok: false, reason: failure }
    : { ok: true, claims: { projectId, buildId, expiresAt, purpose: expected } };
}

/** Why verified claims are still refused: a wrong purpose, expired, or claiming more than allowed. */
function claimsFailure(
  expiresAt: number,
  nowSeconds: number,
  purposeMatches: boolean,
  expected: StorybookTokenPurpose,
): StorybookTokenFailure | undefined {
  if (!purposeMatches) {
    return "scope";
  }
  if (expiresAt <= nowSeconds) {
    return "expired";
  }
  const longest = PURPOSE_TTL[expected] ?? MAX_STORYBOOK_URL_TTL;
  return expiresAt > nowSeconds + longest ? "scope" : undefined;
}

/** The key tokens are signed with; throws when none is configured. */
function currentSecret(secret: SecretInput): string {
  const current = typeof secret === "object" ? secret.current : secret;
  if (!current) {
    throw new Error("Cannot sign a Storybook URL: ShelfConfig.secret is not configured");
  }
  return current;
}

/** The current secret alone, for a purpose a rotation must end at once. */
function currentOnly(secret: SecretInput): string[] {
  const current = typeof secret === "object" ? secret.current : secret;
  return current ? [current] : [];
}

/** Every key a token may verify with: the current secret and, during a rotation, the previous one. */
function secretsOf(secret: SecretInput): string[] {
  const keys = typeof secret === "object" ? [secret.current, secret.previous] : [secret];
  return keys.filter((key): key is string => key !== undefined && key !== "");
}

function signature(secret: string, purpose: StorybookTokenPurpose, payload: string): string {
  const key = createHmac("sha256", secret).update(KEY_CONTEXTS[purpose]).digest();
  return createHmac("sha256", key).update(payload).digest("base64url");
}
