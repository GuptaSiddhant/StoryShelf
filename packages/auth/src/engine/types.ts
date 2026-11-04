import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { EmailSender } from "@storyshelf/core/adapter/email-sender";
import type { Auth } from "@storyshelf/core/auth";
import type { Logger } from "@storyshelf/core/logger";
import type { BetterAuthPlugin } from "better-auth";

/** Provider id minted on every engine identity (method attribution is future work). */
export const ENGINE_PROVIDER_ID = "better-auth";

/** Options for {@link createShelfAuth}. */
export interface ShelfAuthOptions {
  /** Shelf database (any driver; auth tables migrate via driver DDL). */
  db: DatabaseAdapter;
  /** Session/cookie signing secret (non-empty; Better Auth validates strength). */
  secret: string;
  /** Public base URL issuing auth responses (callback + cookie scope). */
  baseURL: string;
  /** Enable email/password login. Defaults to true. */
  emailPassword?: boolean;
  /**
   * Email transport shared with notification channels. When set, invite
   * links are emailed best-effort and password-reset requests send mail;
   * when unset, invites stay out-of-band links and resets stay re-invite.
   */
  emailSender?: EmailSender;
  /** Sender address for auth mail (defaults to `storyshelf@<baseURL host>`). */
  fromEmail?: string;
  /**
   * System-event hook for host-owned fan-out (e.g. `sys:user-created`,
   * `sys:invite-issued` to admin channels). Best-effort: failures are
   * logged and swallowed, never break auth flows.
   */
  onAuthSystemEvent?: (
    event: "sys:user-created" | "sys:invite-issued",
    data: Record<string, unknown>,
  ) => unknown;
  /** Host-owned logger for auth diagnostics (explicit override only). */
  logger?: Logger;
  /** Native social providers (GitHub, Google, Entra, Cognito...), each one button. */
  social?: ShelfSocialProvider[];
  /** OAuth/OIDC providers, each rendered as one login button. Defaults to none. */
  oauth?: ShelfOAuthProvider[];
  /** WebAuthn passkeys (profile enrollment; sign-in ceremony is E8). Defaults to off. */
  passkeys?: ShelfPasskeyOptions;
  /** Domain-routed SSO (OIDC discovery + SAML via samlify). Defaults to none. */
  sso?: ShelfSSOOptions;
  /** Extra Better Auth plugins (passkey, SSO, ...). Defaults to none. */
  plugins?: BetterAuthPlugin[];
  /** Session lifetime in days. Defaults to 7 (current parity). */
  sessionExpiresInDays?: number;
}

/** One OAuth/OIDC login method (Keycloak preset or explicit endpoints). */
export interface ShelfOAuthProvider {
  /** Stable id used in routes and descriptors (e.g. "keycloak"). */
  id: string;
  /** Human label rendered on the login button. */
  label: string;
  /** OAuth client ID registered with the provider. */
  clientId: string;
  /** OAuth client secret (omit for public clients). */
  clientSecret?: string;
  /** OIDC discovery URL; prefer over explicit endpoints when available. */
  discoveryUrl?: string;
  /** Explicit endpoint overrides (skip discovery for these). */
  authorizationUrl?: string;
  /** Explicit endpoint overrides (skip discovery for these). */
  tokenUrl?: string;
  /** Explicit endpoint overrides (skip discovery for these). */
  userInfoUrl?: string;
  /** OAuth scopes. Defaults to `["openid", "email", "profile"]`. */
  scopes?: string[];
}

/** One native social login method (Better Auth built-in provider). */
export interface ShelfSocialProvider {
  /** Better Auth provider key (e.g. "github", "microsoft", "cognito"). */
  id: "github" | "gitlab" | "google" | "microsoft" | "cognito";
  /** Human label rendered on the login button. */
  label: string;
  /** OAuth client ID registered with the provider. */
  clientId: string;
  /** OAuth client secret (omit for public clients). */
  clientSecret?: string;
  /** Provider-specific options (tenantId, domain, region, userPoolId, issuer...). */
  extra?: Record<string, string | undefined>;
}

/** WebAuthn passkey config (profile enrollment; sign-in ceremony is E8). */
export interface ShelfPasskeyOptions {
  /**
   * Relying-party id. Defaults to the baseURL hostname.
   *
   * WebAuthn needs a secure context: `localhost` (any port) or HTTPS.
   * Plain-HTTP LAN/IP deployments cannot use passkeys — the UI hides
   * passkey affordances there (see `passkey-ceremony.ts`).
   */
  rpID?: string;
  /** Human-readable site title. Defaults to "StoryShelf". */
  rpName?: string;
  /** Allowed origins (no trailing slash). Defaults to the baseURL origin. */
  origin?: string | string[];
}

/** OIDC SSO connection (discovery-based, resolved by email domain). */
export interface ShelfSSOOidc {
  /** IdP issuer (e.g. the Keycloak realm URL). */
  issuer: string;
  /** Discovery document URL. Defaults to `issuer + /.well-known/openid-configuration`. */
  discoveryUrl?: string;
  /** OAuth client ID registered with the provider. */
  clientId: string;
  /** OAuth client secret (omit for public clients). */
  clientSecret?: string;
  /** OAuth scopes. Defaults to `["openid", "email", "profile"]`. */
  scopes?: string[];
  /** Use PKCE. Defaults to true. */
  pkce?: boolean;
}

/** SAML SSO connection (samlify via the SSO plugin; never hand-rolled XML). */
export interface ShelfSSOSaml {
  /** SP entity ID (our audience; also the metadata default). */
  issuer: string;
  /** IdP SSO URL (required by the plugin type; unused when `metadataXml` is set). */
  entryPoint: string;
  /** IdP signing cert(s), PEM (ignored when `metadataXml` is set). */
  cert?: string | string[];
  /** IdP metadata XML (preferred: carries entity ID, endpoints, and certs). */
  metadataXml?: string;
  /** IdP entity ID (required without `metadataXml`). */
  entityID?: string;
  /** Expected audience (defaults to the SP issuer). */
  audience?: string;
  /** Reject unsigned assertions. Defaults to false. */
  wantAssertionsSigned?: boolean;
}

/** IdP group sync for one SSO provider (site role + project memberships). */
export interface ShelfSSOGroupSync {
  /**
   * Claim (OIDC) or attribute (SAML) name(s) carrying group memberships.
   * First hit wins across names; arrays pass through, a lone string counts
   * as one group (never whitespace-split). Defaults to `["groups"]`.
   */
  claim?: string | string[];
  /**
   * Exact group names granting the site `admin` role. Full reconcile:
   * members not matched reset to `member` on every SSO sign-in.
   * Defaults to none (roles untouched).
   */
  admins?: string[];
}

/** One domain-routed SSO login method (OIDC, SAML, or both). */
export interface ShelfSSOProvider {
  /** Stable id used in routes and descriptors (e.g. "acme-sso"). */
  id: string;
  /** Human label rendered on the login button. */
  label: string;
  /** Email domain routing key (e.g. "acme.example"). */
  domain: string;
  /** OIDC connection. Defaults to none. */
  oidc?: ShelfSSOOidc;
  /** SAML connection. Defaults to none. */
  saml?: ShelfSSOSaml;
  /** IdP group sync. Defaults to none (no group reads, roles untouched). */
  groups?: ShelfSSOGroupSync;
}

/** Domain-routed SSO (OIDC discovery + SAML). Defaults to none. */
export interface ShelfSSOOptions {
  /** SSO providers, each rendered as one login button. */
  providers: ShelfSSOProvider[];
  /** Require explicit sign-up confirmation for new SSO users. Defaults to false. */
  disableImplicitSignUp?: boolean;
}

/** Session user fields the shelf reads back. */
export interface EngineSessionUser {
  id: string;
  email: string;
  name: string;
  image?: string | null;
}

/** Subset of the Better Auth instance surface the shelf uses. */
export interface ShelfAuthInstance {
  /** HTTP handler (mount at `/api/auth/*`). */
  handler: (request: Request) => Response | Promise<Response>;
  api: {
    /** Resolve the session user from request headers (null when anonymous). */
    getSession(input: { headers: Headers }): Promise<{ user: EngineSessionUser } | null>;
    /** Revoke the session carried by the headers. */
    signOut(input: { headers: Headers }): Promise<unknown>;
  };
}

/** Engine handle: raw instance for mounting plus the Auth singleton. */
export interface ShelfAuth {
  /** Better Auth instance (mount `auth.handler`, call `auth.api.*`). */
  auth: ShelfAuthInstance;
  /** Auth singleton (check/destroySession, invites, sessions, descriptors). */
  adapter: Auth;
}
