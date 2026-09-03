---
title: "@storyshelf/auth-oauth"
description: Add OAuth and OpenID Connect login to StoryShelf.
---

`@storyshelf/auth-oauth` authenticates users with an OpenID Connect provider such as Keycloak, Authentik, Okta, GitHub, GitLab, or Google. It uses the authorization-code flow and seven-day HMAC-signed sessions.

## Install

```sh
nub add @storyshelf/auth-oauth
```

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

const app = createShelfRouter({ database, storage, auth });
```

The issuer, client credentials, session secret, and registered callback URL are required. The default scopes are `openid`, `email`, and `profile`.

## API

`createOAuthAuth(options)` returns an `AuthAdapter` with `loginUrl(state)`, `handleCallback(callback)`, `check(request)`, `createSession(user)`, and `destroySession(sessionId)`. The callback exchanges the authorization code, fetches user information, and returns an `AuthUser` or `null`.

Register `redirectUrl` with the provider before deployment. The [authentication guide](../../guides/auth/) covers provider configuration and project roles.
