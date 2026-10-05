---
title: "@storyshelf/auth"
description: Better Auth engine for StoryShelf — local accounts, social login, enterprise SSO/SAML, and passkeys.
---

`@storyshelf/auth` is the auth engine: [Better Auth](https://www.better-auth.com/docs) owns OIDC/SAML/WebAuthn wire protocols ([concepts](https://www.better-auth.com/docs/concepts/oauth), [hooks](https://www.better-auth.com/docs/concepts/hooks#databasehooks), [session management](https://www.better-auth.com/docs/concepts/session-management)) while StoryShelf keeps users, memberships, invites, and UI. Sessions are Better Auth DB rows under the `storyshelf_session` cookie (seven-day TTL, `cookieCache` off so revocation bites immediately — see [cookie cache](https://www.better-auth.com/docs/concepts/session-management#cookie-cache)); engine identities mirror into the shelf `users` table with roles preserved.

## Install

```sh
nub add @storyshelf/auth
```

[![JSR](https://jsr.io/badges/@storyshelf/auth)](https://jsr.io/@storyshelf/auth) [![JSR Score](https://jsr.io/badges/@storyshelf/auth/score)](https://jsr.io/@storyshelf/auth)

- [npm package](https://www.npmjs.com/package/@storyshelf/auth) — install tarballs and version history.
- [JSR package](https://jsr.io/@storyshelf/auth) — TypeScript-first registry page.
- [Public API reference](https://jsr.io/@storyshelf/auth/doc) — generated docs for every export; start here to learn the API.
- [Source on GitHub](https://github.com/GuptaSiddhant/storyshelf/tree/main/packages/auth) — package directory on `main`.

Exact pins: [`better-auth@1.7.6`](https://www.better-auth.com/docs/changelog), [`@better-auth/passkey@1.7.6`](https://www.better-auth.com/docs/plugins/passkey), [`@better-auth/sso@1.7.6`](https://www.better-auth.com/docs/plugins/sso).

## Configure

```ts
import { createShelfAuth, resolveAuthOptions } from "@storyshelf/auth";

const shelf = createShelfAuth(await resolveAuthOptions({
  db: database,
  secret: "{env:SECRET}",
  baseURL: process.env.PUBLIC_BASE_URL!,
  passkeys: {},
}));

const app = createShelfApp({ database, storage, auth: shelf.adapter });
```

Mounts at `/api/auth/*` via the [Hono integration](https://www.better-auth.com/docs/integrations/hono); the login page renders one widget per configured method (`password`, `oauth`, `passkey`, `sso` descriptors — see [database adapters](https://www.better-auth.com/docs/concepts/database#custom-adapters)).

## Recipes

- **Social** — `githubPreset`, `gitlabPreset`, `googlePreset`, `entraPreset`, `cognitoPreset` (native provider integrations — see [social providers](https://www.better-auth.com/docs/reference/social-providers)).
- **Enterprise OIDC** — `keycloakPreset`, `oktaPreset`, `auth0Preset` (configs via [generic OAuth](https://www.better-auth.com/docs/plugins/generic-oauth)).
- **Enterprise SSO** — `ssoKeycloakPreset`, `ssoOktaPreset`, `ssoAuth0Preset`, `ssoGooglePreset`, `ssoEntraPreset` (domain-routed OIDC via IdP discovery) and `samlPreset` (explicit IdP fields or metadata XML) via the [SSO plugin](https://www.better-auth.com/docs/plugins/sso). IdP callback URLs via `ssoCallbackUrls(baseURL, providerId)`.
- **Invites** — `issueInvite` / `verifyInvite` / `acceptInvite` (single-use, 7-day, hashed at rest; re-invite is password recovery). Minimum password length is 12.
- **Dev bootstrap** — `ensurePasswordAdmin(database, { email, password })` provisions the env-driven local admin.
- **Sessions/passkeys inventory** — `listUserSessions`, `listUserPasskeys`, `hasPasswordCredential` (drive the `/profile` Devices and Passkeys sections).

Secrets stay out of code with `{env:NAME}` refs (resolved from `process.env`, then your `resolveSecrets` hook for Vault/AWS/GCP). Precedence: explicit literal > `{env}` ref > schema default; code recipes > DB rows > plugin defaults.

## Plugin contract

Custom [Better Auth](https://www.better-auth.com/docs) plugins ride `plugins: [...]`. Two boot-time guards: login method ids must be unique across providers, and custom endpoints must not shadow shelf-reserved engine paths (`/sign-in/*`, `/sign-up/email`, session revocation — see [endpoints](https://www.better-auth.com/docs/reference/endpoints)). Runtime SSO provider management is blocked — providers are code-driven recipes.

The broader auth modes and project roles are covered in the [authentication guide](../../guides/auth/) and [auth concepts](../../concepts/auth/). Upstream docs: [Better Auth](https://www.better-auth.com/docs), [passkey](https://www.better-auth.com/docs/plugins/passkey), [SSO](https://www.better-auth.com/docs/plugins/sso), [Hono](https://www.better-auth.com/docs/integrations/hono).
