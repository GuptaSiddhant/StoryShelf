---
title: "@storyshelf/auth-oauth"
description: Add OAuth and OpenID Connect login to StoryShelf.
---

`@storyshelf/auth-oauth` authenticates users with an OpenID Connect provider via the authorization-code flow, with seven-day HMAC-signed sessions. Endpoints resolve via OIDC Discovery with Keycloak-layout fallback, and per-provider presets are available via `@storyshelf/auth-oauth/presets`. Like all auth adapters it proves identity only — roles come from project memberships.

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

The issuer, client credentials, session secret, and registered callback URL are required. The default scopes are `openid`, `email`, and `profile`. Endpoints resolve via OIDC Discovery with Keycloak-layout fallback; see the package README for explicit endpoint overrides.

## Provider setup

Use a preset from `@storyshelf/auth-oauth` instead of hand-building endpoint URLs:

- **Keycloak** — `keycloakPreset(realmUrl, options)`; optionally add a Group Membership mapper emitting `groups`.
- **Okta** — `oktaPreset(domain, authorizationServerId, options)`; configure a `groups` claim (filter or expression) and request the `groups` scope.
- **Microsoft Entra ID** — `entraPreset(tenantId, options)`; set `groupMembershipClaims` in the app manifest. Groups arrive as **object IDs**, so map IDs not display names. Beyond ~200 memberships the claim is omitted (overage) — login fails closed; restrict emitted groups to this app.
- **Amazon Cognito** — `cognitoPreset(region, userPoolId, options)`; groups arrive as `cognito:groups` (read by default).
- **Auth0** — `auth0Preset(domain, options)` plus a tenant Action writing a namespaced custom claim (Auth0 emits no group claim by default); pass the claim name via `groupClaims`.
- **Google Workspace** — not supported (no OIDC group path; would need Admin SDK domain-wide delegation).

Map groups to the site `admin`/`viewer` roles with `adminGroups`/`viewerGroups` (exact match). Project-level mapping (`group name → project role`) lives in each project's Members settings tab and syncs at next login.

### Worked example: Microsoft Entra ID

```ts
import { createOAuthAuth } from "@storyshelf/auth-oauth";
import { entraPreset } from "@storyshelf/auth-oauth/presets";

const auth = createOAuthAuth(
  entraPreset(process.env.ENTRA_TENANT_ID!, {
    clientId: process.env.OIDC_CLIENT_ID!,
    clientSecret: process.env.OIDC_CLIENT_SECRET!,
    secret: process.env.SHELF_SECRET!,
    redirectUrl: process.env.OIDC_REDIRECT_URL!,
    // Entra emits group object IDs, not display names — map IDs here.
    // Requires groupMembershipClaims in the app manifest.
    adminGroups: ["3b4c5d6e-7f8a-9b0c-d1e2-f3a4b5c6d7e8"],
  }),
);

const app = createShelfApp({ database, storage, auth });
```

The other presets follow the same shape — `keycloakPreset(realmUrl, base)`, `oktaPreset(domain, authorizationServerId, base)`, `cognitoPreset(region, userPoolId, base)`, `auth0Preset(domain, base)` — each returning options for `createOAuthAuth`. See the package README for a copy-pasteable example of each.

## API

`createOAuthAuth(options)` returns an `AuthAdapter` with `loginUrl(state)`, `handleCallback(callback)`, `check(request)`, `createSession(user)`, and `destroySession(sessionId)`. The callback exchanges the authorization code, fetches user information (groups included), and returns an `AuthUser` or `null`.

Register `redirectUrl` with the provider before deployment. The [authentication guide](../../guides/auth/) covers provider configuration and project roles.
