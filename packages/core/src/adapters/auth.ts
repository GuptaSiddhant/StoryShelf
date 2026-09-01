import type { AdapterMetadata } from "./metadata.ts";
import type { ProjectRole, SiteRole } from "../types.ts";

/** Shared session cookie name used by all auth adapters (ADR 0008). */
export const SESSION_COOKIE = "storyshelf_session";

/** An authenticated user of the platform. */
export interface AuthUser {
  /** User ID. */
  id: string;
  /** User email. */
  email: string;
  /** Display name. */
  name: string;
  /** Optional avatar URL. */
  avatarUrl?: string;
  /** Site-wide role. */
  role: SiteRole;
}

/** Data passed to an auth adapter when an OAuth callback is received. */
export interface AuthCallback {
  /** Provider name. */
  provider: string;
  /** Authorization code from the provider. */
  code: string;
  /** Anti-CSRF state value. */
  state: string;
}

/** Access controls granted to a user for a specific project. */
export interface ProjectAccess {
  /** Project role. */
  role: ProjectRole;
}

/** Pluggable authentication abstraction (ADR 0008). */
export interface AuthAdapter {
  /** Adapter identity. */
  readonly metadata?: AdapterMetadata;
  /** Resolve the current user from a request, or null if unauthenticated. */
  check(request: Request): Promise<AuthUser | null>;
  /** Create a session for a user and return a session token. */
  createSession(user: AuthUser): Promise<string>;
  /** Destroy a session by its id. */
  destroySession(sessionId: string): Promise<void>;
  /** Handle an OAuth callback and return the resolved user, if supported. */
  handleCallback?(callback: AuthCallback): Promise<AuthUser | null>;
}
