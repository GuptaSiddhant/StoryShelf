# @storyshelf/auth

Better Auth engine for StoryShelf — local accounts, social login, enterprise SSO/SAML, and passkeys. See the [website docs](https://storyshelf.dev) and the [package page](https://github.com/GuptaSiddhant/StoryShelf/tree/main/apps/website/src/content/docs/packages/auth.md) for full guides.

## Install

```sh
nub add @storyshelf/auth
```

Exact pins: `better-auth@1.7.6`, `@better-auth/passkey@1.7.6`, `@better-auth/sso@1.7.6` — see the [Better Auth changelog](https://www.better-auth.com/docs/changelog) and [docs](https://www.better-auth.com/docs).

## Quick start

```ts
import { createShelfAuth, githubPreset } from "@storyshelf/auth";

const shelf = createShelfAuth({
  db: database,
  secret: process.env.SECRET!, // ≥ 32 chars
  baseURL: process.env.PUBLIC_BASE_URL!,
  social: [githubPreset({ clientId: "...", clientSecret: "{env:GITHUB_CLIENT_SECRET}" })],
  passkeys: {},
});

const app = createShelfApp({ database, storage, auth: shelf.adapter });
// Mounts at /api/auth/* via the Hono integration — https://www.better-auth.com/docs/integrations/hono
```

- Sessions: Better Auth DB rows under `storyshelf_session` (7-day TTL, `cookieCache` off) — https://www.better-auth.com/docs/concepts/session-management
- Social/OIDC: https://www.better-auth.com/docs/reference/social-providers, https://www.better-auth.com/docs/plugins/generic-oauth
- Passkeys: https://www.better-auth.com/docs/plugins/passkey
- SSO/SAML: https://www.better-auth.com/docs/plugins/sso

## Recipes

- **Social** — `githubPreset`, `gitlabPreset`, `googlePreset`, `entraPreset`, `cognitoPreset` (native provider integrations — see [social providers](https://www.better-auth.com/docs/reference/social-providers)).
- **Enterprise OIDC** — `keycloakPreset`, `oktaPreset`, `auth0Preset` (configs via [generic OAuth](https://www.better-auth.com/docs/plugins/generic-oauth)).
- **Enterprise SSO** — `ssoKeycloakPreset`, `ssoOktaPreset`, `ssoAuth0Preset`, `ssoGooglePreset`, `ssoEntraPreset` (domain-routed OIDC via IdP discovery) and `samlPreset` (explicit IdP fields or metadata XML) via the [SSO plugin](https://www.better-auth.com/docs/plugins/sso). IdP callback URLs via `ssoCallbackUrls(baseURL, providerId)`.
- **Invites** — `issueInvite` / `verifyInvite` / `acceptInvite` (single-use, 7-day, hashed at rest; re-invite is password recovery). Minimum password length is 12.
- **Dev bootstrap** — `ensurePasswordAdmin(database, { email, password })` provisions the env-driven local admin.
- **Sessions/passkeys inventory** — `listUserSessions`, `listUserPasskeys`, `hasPasswordCredential` (drive the `/profile` Devices and Passkeys sections).

Secrets stay out of code with `{env:NAME}` refs (resolved from `process.env`, then your `resolveSecrets` hook for Vault/AWS/GCP). Precedence: explicit literal > `{env}` ref > schema default; code recipes > DB rows > plugin defaults.

See the [authentication guide](https://storyshelf.js.org/guides/auth/) and [auth concepts](https://storyshelf.js.org/concepts/auth/) for the invite playbook, passkey prerequisites, secrets, and the engine→shelf user mirror.

## Plugin contract

Custom [Better Auth](https://www.better-auth.com/docs) plugins ride `plugins: [...]`. Two boot-time guards: login method ids must be unique across providers, and custom endpoints must not shadow shelf-reserved engine paths (`/sign-in/*`, `/sign-up/email`, session revocation — see [endpoints](https://www.better-auth.com/docs/reference/endpoints)). Runtime SSO provider management is blocked — providers are code-driven recipes.
