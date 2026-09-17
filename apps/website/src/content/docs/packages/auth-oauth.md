---
title: "@storyshelf/auth-oauth"
description: Add OAuth and OpenID Connect login to StoryShelf.
---

`@storyshelf/auth-oauth` authenticates users with an OpenID Connect provider via the authorization-code flow, with seven-day HMAC-signed sessions. Endpoints currently follow the Keycloak layout (`{issuer}/protocol/openid-connect/{auth,token,userinfo}`), so Keycloak works out of the box and any provider exposing those paths works too; generic OIDC Discovery and per-provider presets are planned. Like all auth adapters it proves identity only — roles come from project memberships.

## Install

```sh
nub add @storyshelf/auth-oauth
```

[![JSR](https://jsr.io/badges/@storyshelf/auth-oauth)](https://jsr.io/@storyshelf/auth-oauth) [![JSR Score](https://jsr.io/badges/@storyshelf/auth-oauth/score)](https://jsr.io/@storyshelf/auth-oauth)

- [npm package](https://www.npmjs.com/package/@storyshelf/auth-oauth) — install tarballs and version history.
- [JSR package](https://jsr.io/@storyshelf/auth-oauth) — TypeScript-first registry page.
- [Public API reference](https://jsr.io/@storyshelf/auth-oauth/doc) — generated docs for every export; start here to learn the API.
- [Source on GitHub](https://github.com/GuptaSiddhant/storyshelf/tree/main/packages/auth-oauth) — package directory on `main`.

## Configure

```ts
import { createOAuthAuth } from "@storyshelf/auth-oauth";

const auth = createOAuthAuth({
  issuer: process.env.OIDC_ISSUER!,
  clientId: process.env.OIDC_CLIENT_ID!,
  clientSecret: process.env.OIDC_CLIENT_SECRET!,
  secret: process.env.SHELF_SECRET!,
  redirectUrl: process.env.OIDC_REDIRECT_URL!,
  scopes: ["openid", "email", "profile"],
});

const app = createShelfApp({ database, storage, auth });
```

The issuer, client credentials, session secret, and registered callback URL are required. The default scopes are `openid`, `email`, and `profile`.

## API

`createOAuthAuth(options)` returns an `AuthAdapter` with `loginUrl(state)`, `handleCallback(callback)`, `check(request)`, `createSession(user)`, and `destroySession(sessionId)`. The callback exchanges the authorization code, fetches user information, and returns an `AuthUser` or `null`.

Register `redirectUrl` with the provider before deployment. The [authentication guide](../../guides/auth/) covers provider configuration and project roles.
