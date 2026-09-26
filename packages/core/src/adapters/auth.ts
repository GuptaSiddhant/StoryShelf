import type { ProjectRole, SiteRole } from "../types.ts";
/**
 * Auth adapter interface: authenticate users and resolve project access.
 */
import type { Adapter } from "./metadata.ts";

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
  /**
   * Identity-provider group memberships (names or IDs, provider-dependent).
   * Populated by OIDC adapters when the provider exposes group claims;
   * absent otherwise. Drives group-to-role mapping at login.
   */
  groups?: string[];
  /**
   * Login method that minted this identity (composite auth only).
   * Matches a `MultiAuthMethod.id`; absent for single-adapter deployments.
   */
  providerId?: string;
}

/** Data passed to an auth adapter when an OAuth callback is received. */
export interface AuthCallback {
  /** Provider name. */
  provider: string;
  /**
   * Login method id (composite auth only). Routes the callback to the
   * matching member; when absent, a sole callback-capable member handles it.
   */
  providerId?: string;
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
export interface AuthAdapter extends Adapter<{ readonly category: "auth" }> {
  /** Resolve the current user from a request, or null if unauthenticated. */
  check(request: Request): Promise<AuthUser | null>;
  /** Create a session for a user and return a session token. */
  createSession(user: AuthUser): Promise<string>;
  /** Destroy a session by its id. */
  destroySession(sessionId: string): Promise<void>;
  /** Handle an OAuth callback and return the resolved user, if supported. */
  handleCallback?(callback: AuthCallback): Promise<AuthUser | null>;
}

/** Auth adapter that verifies a shared password (or tiered passwords). */
export interface PasswordLoginAuth extends AuthAdapter {
  /** Verify `password` and return a session token for `user`. */
  login(password: string, user: AuthUser): Promise<string>;
}

/** Whether an adapter offers shared-password login. */
export function hasPasswordLogin(auth: AuthAdapter): auth is PasswordLoginAuth {
  return "login" in auth;
}

/** Auth adapter that starts an SSO authorization-code flow. */
export interface SsoLoginAuth extends AuthAdapter {
  /** Build the provider authorization URL for the given anti-CSRF `state`. */
  loginUrl(state: string): string;
}

/** Whether an adapter offers SSO login. */
export function hasSsoLogin(auth: AuthAdapter): auth is SsoLoginAuth {
  return "loginUrl" in auth;
}

/** One login method inside a composite adapter. */
export interface MultiAuthMethod {
  /** Stable id used in `/auth/login/:id` routes and `AuthUser.providerId`. */
  readonly id: string;
  /** Human label rendered on the login page (e.g. "Keycloak"). */
  readonly label: string;
  /** The member adapter behind this method. */
  readonly adapter: AuthAdapter;
}

/** Options for {@link createMultiAuth}. */
export interface MultiAuthOptions {
  /** Secret signing composite sessions (replaces member secrets for new logins). */
  secret: string;
  /** Login methods, in login-page display order. Ids must be unique. */
  methods: MultiAuthMethod[];
}

/** Auth adapter fanning out over several login methods. */
export interface MultiAuth extends AuthAdapter {
  /** Login methods in display order. */
  methods(): MultiAuthMethod[];
}

/** Whether an adapter is a composite of several login methods. */
export function isMultiAuth(auth: AuthAdapter): auth is MultiAuth {
  return (
    "methods" in auth && typeof (auth as unknown as { methods: unknown }).methods === "function"
  );
}
