# @storyshelf/auth-oauth

An OIDC auth adapter for StoryShelf (kept under its historic `auth-oauth` name): authenticates users against an OpenID Connect provider via the authorization-code flow. Endpoints resolve via OIDC Discovery with explicit overrides, falling back to the Keycloak layout (`{issuer}/protocol/openid-connect/{auth,token,userinfo}`); provider presets live under `@storyshelf/auth-oauth/presets`. Sessions are HMAC-signed cookies with a 7-day TTL.

> **Scope note:** this adapter authenticates (proves identity) but never authorizes. Project roles come from memberships; new users sign in with the site `member` role. Group-to-role mapping is planned separately.

## Install

```sh
nub add @storyshelf/auth-oauth
```

or

```sh
npm install @storyshelf/auth-oauth
```

## Quick start

```ts
import { createOAuthAuth } from "@storyshelf/auth-oauth";
import { createShelfApp } from "@storyshelf/app";

const auth = createOAuthAuth({
  issuer: process.env.OIDC_ISSUER!,
  clientId: process.env.OIDC_CLIENT_ID!,
  clientSecret: process.env.OIDC_CLIENT_SECRET!,
  secret: process.env.SHELF_SECRET!,      // session signing secret
  redirectUrl: process.env.OIDC_REDIRECT_URL!,
  scopes: ["openid", "email", "profile"], // optional
});

const app = createShelfApp({ database, storage, auth });
```

## API

### `OAuthAuthOptions`

```ts
interface OAuthAuthOptions {
  issuer: string;        // OIDC issuer base URL
  clientId: string;      // OIDC client id
  clientSecret: string;  // OIDC client secret
  secret: string;        // secret used to HMAC-sign session cookies
  redirectUrl: string;   // callback/redirect URI registered with the provider
  scopes?: string[];     // defaults to ["openid", "email", "profile"]
  discoveryUrl?: string | null;  // defaults to {issuer}/.well-known/openid-configuration; null disables discovery
  authorizationEndpoint?: string; // explicit overrides (skip discovery for these)
  tokenEndpoint?: string;
  userinfoEndpoint?: string;
  groupClaims?: string[];  // defaults to ["groups", "cognito:groups"]
  adminGroups?: string[];  // exact-match groups granting site admin
  viewerGroups?: string[]; // exact-match groups granting site viewer
}
```

Endpoints resolve via OIDC Discovery (cached after the first callback, warmed
at setup), falling back to explicit overrides and then the Keycloak layout.
Group memberships are read from the configured claims and stored on the
session; Entra group overage (`_claim_names`) fails closed with a message
pointing at directory setup.

### Provider presets

```ts
import { createOAuthAuth } from "@storyshelf/auth-oauth";
import {
  auth0Preset,
  cognitoPreset,
  entraPreset,
  keycloakPreset,
  oktaPreset,
} from "@storyshelf/auth-oauth/presets";

const base = {
  clientId: process.env.OIDC_CLIENT_ID!,
  clientSecret: process.env.OIDC_CLIENT_SECRET!,
  secret: process.env.SHELF_SECRET!,
  redirectUrl: process.env.OIDC_REDIRECT_URL!,
};

// Keycloak (self-hosted default — realm URL only)
const keycloak = createOAuthAuth(
  keycloakPreset("https://id.example.com/realms/teams", {
    ...base,
    adminGroups: ["shelf-admins"],
  }),
);

// Okta (custom authorization server + groups claim/scope configured in Okta)
const okta = createOAuthAuth(oktaPreset("id.example.okta.com", "default", { ...base }));

// Microsoft Entra ID (groups arrive as object IDs — match on IDs, not names)
const entra = createOAuthAuth(
  entraPreset("tenant-id", {
    ...base,
    adminGroups: ["<object-id of shelf-admins>"],
  }),
);

// Amazon Cognito (groups arrive as cognito:groups — read by default)
const cognito = createOAuthAuth(cognitoPreset("us-east-1", "us-east-1_abc123", { ...base }));

// Auth0 (tenant Action must write a namespaced custom claim first)
const auth0 = createOAuthAuth({
  ...auth0Preset("tenant.us.auth0.com", { ...base }),
  groupClaims: ["https://storyshelf/groups"],
});
```

- `keycloakPreset(realmUrl, options)` — realm issuer, Keycloak endpoint layout.
- `oktaPreset(domain, authorizationServerId, options)` — custom authorization server v1 endpoints.
- `entraPreset(tenantId, options)` — tenant issuer; groups arrive as object IDs (match on IDs, not names).
- `cognitoPreset(region, userPoolId, options)` — groups arrive as `cognito:groups`.
- `auth0Preset(domain, options)` — Auth0 emits no group claim by default; add a tenant Action writing a namespaced custom claim (e.g. `https://storyshelf/groups`) and pass it via `groupClaims`.
- Google Workspace has no OIDC group path (requires Admin SDK domain-wide delegation) and is not supported.

### `createOAuthAuth(options: OAuthAuthOptions): OAuthAuth`

Returns an `OAuthAuth`, which extends `AuthAdapter` with an extra method:

```ts
interface OAuthAuth extends AuthAdapter {
  loginUrl(state: string): string;
}
```

- `loginUrl(state)` — builds the authorization URL to redirect users to your OIDC provider.
- `handleCallback(callback)` — exchanges the authorization code for a token and fetches the userinfo endpoint, returning an `AuthUser` or `null`.
- `check(request)`, `createSession(user)`, `destroySession(sessionId)` — the standard `AuthAdapter` interface, with sessions verified using timing-safe comparison.

## How it fits in

`auth-oauth` is the `auth` option for `createShelfApp` when you want to sign in with an existing identity provider. When supplied, the router redirects unauthenticated UI requests to `loginUrl` and handles the OIDC callback to establish a session.

See `docs/architecture.md` and ADR 0008.
