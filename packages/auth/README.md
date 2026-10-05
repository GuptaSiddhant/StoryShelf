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

- `githubPreset`, `gitlabPreset`, `googlePreset`, `entraPreset`, `cognitoPreset`
- `keycloakPreset`, `oktaPreset`, `auth0Preset`
- `ssoKeycloakPreset`, `ssoOktaPreset`, `ssoAuth0Preset`, `ssoGooglePreset`, `ssoEntraPreset`, `samlPreset` + `ssoCallbackUrls(baseURL, id)`
- `issueInvite` / `verifyInvite` / `acceptInvite` (invite-only, re-invite is recovery)
- `ensurePasswordAdmin`, `resolveAuthOptions` with `{env:NAME}` + `resolveSecrets`

See `apps/website/src/content/docs/guides/auth.md` and `apps/website/src/content/docs/concepts/auth.md` for the invite playbook, passkey prerequisites, secrets, and the engine→shelf user mirror.
