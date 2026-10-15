/**
 * Service-neutral OAuth 2 contract for "connect your own account" flows. Any
 * adapter that talks to a third party on behalf of a user (design tools,
 * issue trackers, …) can expose an {@link OAuthClient}; the app owns the
 * redirect/callback routes and core owns token storage and refresh.
 */

/** Tokens returned by an authorization-code exchange or a refresh. */
export interface OAuthTokens {
  accessToken: string;
  /** Absent when the service keeps the previous refresh token valid. */
  refreshToken?: string | null;
  /** ISO time the access token stops working, or null when it never expires. */
  expiresAt: string | null;
}

/** Authorization-code grant against one service, with the operator's client credentials held inside. */
export interface OAuthClient {
  /** Consent-screen URL to send the user to. */
  authorizeUrl(opts: { state: string; redirectUri: string }): string;
  /** Exchange the callback `code` for tokens. */
  exchangeCode(opts: {
    code: string;
    redirectUri: string;
    signal?: AbortSignal;
  }): Promise<OAuthTokens>;
  /** Mint a new access token from a refresh token. */
  refresh(opts: { refreshToken: string; signal?: AbortSignal }): Promise<OAuthTokens>;
}

/**
 * Anything a user can connect an account to. Structurally satisfied by adapters
 * (`metadata.kind` identifies the service), so registering one is just
 * listing its adapter.
 */
export interface OAuthConnectable {
  readonly metadata: { readonly kind: string; readonly name: string };
  /** Present only when the operator configured OAuth for the service. */
  readonly oauth?: OAuthClient;
}
