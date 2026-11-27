/**
 * Auth singleton surface: the shelf authentication contract (not an adapter).
 *
 * Owned by core so `ShelfOptions.auth` needs no dependency edge into the
 * engine package (which would cycle: the engine already depends on core).
 * `@storyshelf/auth` implements this interface and re-exports it; app code
 * imports `Auth` (and the shared runtime helpers below) from
 * `@storyshelf/core/auth`, so a server without auth never needs the engine.
 */
import type { AuthUser } from "./types.ts";

/** Login widget kinds in display order (the shelf plugin contract). */
export type EngineLoginMethodKind = "password" | "oauth" | "passkey" | "sso";

/**
 * One login widget on the descriptor-driven login page.
 *
 * Plugin contract: `password` posts the credential form to
 * `/auth/engine/login`; `oauth`/`sso` link at `/auth/engine/:id` (the app
 * starts the provider flow server-side); `passkey` is JS-driven on the page
 * (its `url` is an unused fallback). Method ids must be unique across all
 * providers (checked at boot).
 */
export interface EngineLoginMethod {
  kind: EngineLoginMethodKind;
  id: string;
  label: string;
}

/** One free reachability check of a configured login provider (never a sign-in). */
export interface AuthProviderCheck {
  /** The login method id (`ShelfOAuthProvider.id` or an SSO provider id). */
  id: string;
  /** Human label for the admin System page. */
  label: string;
  /** Fetch the provider's discovery document; the caller bounds it and sanitizes the detail. */
  check: () => Promise<{ ok: boolean; detail?: string }>;
}

/** One device session for the profile device list. */
export interface EngineSessionInfo {
  id: string;
  token: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
}

/** One registered passkey for the profile page. */
export interface EnginePasskeyInfo {
  id: string;
  name: string | null;
  deviceType: string;
  backedUp: boolean;
  transports: string | null;
  aaguid: string | null;
  createdAt: string;
}

/** Auth singleton: the shelf authentication surface (not an adapter). */
export interface Auth {
  /**
   * Whether the session cookie is the `__Host-` one (`HOST_SESSION_COOKIE`), which `subdomain`
   * hosting requires (ADR 0051, decision 9). Absent or false: the `__Secure-` / plain names.
   */
  hostSessionCookie?: boolean;
  /** Raw engine handler (mount at `/api/auth/*`). */
  handler: (request: Request) => Response | Promise<Response>;
  /** Login methods in display order (drives the login page). */
  loginMethods: () => EngineLoginMethod[];
  /** Free discovery checks for the OIDC providers (admin System page); omit when there are none. */
  providerChecks?: () => AuthProviderCheck[];
  /** One-shot boot validation (secret strength); the app calls it directly. */
  setup: () => Promise<void>;
  /** Stage a shelf user and mint a single-use invite token. */
  issueInvite: (input: {
    email: string;
    name: string;
    role: AuthUser["role"];
  }) => Promise<{ inviteId: string; token: string; expiresAt: string }>;
  /** Check an invite token without consuming it (drives the accept page). */
  verifyInvite: (input: { inviteId: string; token: string }) => Promise<{
    email: string;
    name: string;
  }>;
  /** Consume an invite: set the engine credential and return the shelf user. */
  acceptInvite: (input: { inviteId: string; token: string; password: string }) => Promise<AuthUser>;
  /** Whether WebAuthn passkeys are enabled (drives the profile section). */
  passkeysEnabled: () => boolean;
  /** Active device sessions for the profile page (newest first). */
  listSessions: (userId: string) => Promise<EngineSessionInfo[]>;
  /** Registered passkeys for the profile page (oldest first). */
  listPasskeys: (userId: string) => Promise<EnginePasskeyInfo[]>;
  /** Whether the user has a local credential (shows the password form). */
  hasPassword: (userId: string) => Promise<boolean>;
  /**
   * Disable or re-enable a user: flips the shelf flag and eagerly revokes
   * every engine session (the per-request check is the backstop).
   */
  setDisabled: (userId: string, disabled: boolean) => Promise<void>;
  /** Resolve the session user from a request (null when anonymous). */
  check: (request: Request) => Promise<AuthUser | null>;
  /** Forbidden by design: sessions mint at engine endpoints, never here. */
  createSession: (user: AuthUser) => Promise<string>;
  /** Revoke one session by token (accepts the signed cookie value). */
  destroySession: (sessionToken: string) => Promise<void>;
  /**
   * Delete expired `session` and `verification` rows whose `expires_at` is before `cutoffIso`, in
   * bounded batches. Better Auth never sweeps them itself, so the retention timer calls this.
   */
  purgeExpired?: (cutoffIso: string) => Promise<{ sessions: number; verifications: number }>;
  /**
   * Whether `email` names a shared read-only account (compared case-insensitively). The app refuses
   * every write such an account attempts, whether it arrives with the session or a bearer token.
   * Absent: no account is read-only.
   */
  isReadOnlyAccount?: (email: string) => boolean;
  /**
   * The configured read-only account emails (normalized), for the boot check that warns about an
   * account with no user row. Absent or empty: no account is read-only.
   */
  readOnlyAccounts?: () => readonly string[];
  /**
   * The one origin the engine accepts a sign-in from (its base URL's origin). The sign-in page names
   * it when the engine refused a sign-in because the page was opened at another address (#1431).
   * Display only: never a trusted origin, never a link. Absent: the page names no origin.
   */
  configuredOrigin?: () => string;
}

/** The one refusal a read-only account gets for any write (403), from the app and the engine alike. */
export const READ_ONLY_ACCOUNT_MESSAGE =
  "This is a shared read-only account: it can sign in, sign out and read, but it cannot change anything.";

/**
 * The read-only account emails of a comma-separated list (`SHELF_READ_ONLY_ACCOUNTS`), in the form
 * {@link normalizeAccountEmail} gives; empty entries are dropped. An unset or blank value is no account.
 */
export function parseReadOnlyAccounts(value?: string): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => normalizeAccountEmail(entry))
    .filter((entry) => entry !== "");
}

/** A case-insensitive membership test over `emails`; a missing or empty email never matches. */
export function readOnlyAccountMatcher(
  emails?: readonly string[],
): (email?: string | null) => boolean {
  const accounts = new Set((emails ?? []).map((entry) => normalizeAccountEmail(entry)));
  accounts.delete("");
  return (email) =>
    typeof email === "string" && email !== "" && accounts.has(normalizeAccountEmail(email));
}

/**
 * The form two read-only account emails are compared in: Unicode NFKC (so an address typed in
 * another normalization, or with compatibility characters, still matches), trimmed and lowercased.
 */
export function normalizeAccountEmail(email: string): string {
  return email.normalize("NFKC").trim().toLowerCase();
}

/** Minimum password length for local accounts (matches legacy policy). */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Raw session token from a possibly-signed cookie value (`token.signature`).
 * Single shared parser: cookies, CSRF binding, and table lookups must agree.
 */
export function unsignedToken(value: string): string {
  return value.split(".")[0] ?? "";
}
