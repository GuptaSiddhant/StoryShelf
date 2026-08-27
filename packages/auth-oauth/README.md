# @storyshelf/auth-oauth

An OAuth/OIDC auth adapter for StoryShelf: authenticates users against an OpenID Connect provider (e.g. Keycloak) via the authorization-code flow. Sessions are HMAC-signed cookies with a 7-day TTL.

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
import { createShelfRouter } from "@storyshelf/core";

const auth = createOAuthAuth({
  issuer: process.env.OIDC_ISSUER!,
  clientId: process.env.OIDC_CLIENT_ID!,
  clientSecret: process.env.OIDC_CLIENT_SECRET!,
  secret: process.env.SHELF_SECRET!,      // session signing secret
  redirectUrl: process.env.OIDC_REDIRECT_URL!,
  scopes: ["openid", "email", "profile"], // optional
});

const app = createShelfRouter({ database, storage, auth });
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
}
```

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

`auth-oauth` is the `auth` option for `createShelfRouter` when you want to sign in with an existing identity provider. When supplied, the router redirects unauthenticated UI requests to `loginUrl` and handles the OIDC callback to establish a session.

See `docs/architecture.md` and ADR 0008.
