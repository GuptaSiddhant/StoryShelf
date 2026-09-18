import type { AuthAdapter } from "@storyshelf/core/adapter/auth";

/** Options for configuring an OAuth/OIDC auth adapter. */
export interface OAuthAuthOptions {
  /** OIDC issuer base URL. */
  issuer: string;
  /** OAuth client ID. */
  clientId: string;
  /** OAuth client secret. */
  clientSecret: string;
  /** Secret used to sign and verify session cookies. */
  secret: string;
  /** Redirect URL registered with the OIDC provider. */
  redirectUrl: string;
  /** Optional OAuth scopes. Defaults to `openid`, `email`, `profile`. */
  scopes?: string[];
  /**
   * OIDC Discovery document URL. Defaults to
   * `{issuer}/.well-known/openid-configuration`. Set to `null` to disable
   * discovery entirely (explicit endpoints or Keycloak layout are used).
   */
  discoveryUrl?: string | null;
  /** Explicit endpoint overrides (skip discovery for these). */
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userinfoEndpoint?: string;
  /**
   * Claim names read for group memberships, in order. Defaults to
   * `["groups", "cognito:groups"]`. Values are normalized to strings.
   */
  groupClaims?: string[];
  /** Groups (names or provider IDs) granting the site `admin` role. Exact match. */
  adminGroups?: string[];
  /** Groups (names or provider IDs) granting the site `viewer` role. Exact match. */
  viewerGroups?: string[];
}

/** Resolved OIDC endpoints for one provider. */
export interface OidcEndpoints {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
}

/** Shared options every provider preset accepts. */
export interface PresetBaseOptions {
  clientId: string;
  clientSecret: string;
  secret: string;
  redirectUrl: string;
  scopes?: string[];
  groupClaims?: string[];
  adminGroups?: string[];
  viewerGroups?: string[];
}

/** Auth adapter that authenticates against an OAuth/OIDC provider. */
export interface OAuthAuth extends AuthAdapter {
  /** Build the provider authorization URL for a login flow with the given anti-CSRF `state`. */
  loginUrl(state: string): string;
}
