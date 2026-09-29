/**
 * Auth singleton surface: the shelf authentication contract (not an adapter).
 *
 * Owned by core so `ShelfOptions.auth` needs no dependency edge into the
 * engine package (which would cycle: the engine already depends on core).
 * `@storyshelf/auth` implements this interface and re-exports it; app code
 * imports `Auth` from `@storyshelf/auth`.
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
  /** Raw engine handler (mount at `/api/auth/*`). */
  handler: (request: Request) => Response | Promise<Response>;
  /** Login methods in display order (drives the login page). */
  loginMethods: () => EngineLoginMethod[];
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
}
