---
title: OIDC
description: Domain-routed OIDC via the Better Auth SSO plugin — Keycloak, Okta, Auth0, Entra, Google.
---

Domain-routed OIDC through the [SSO plugin](https://www.better-auth.com/docs/plugins/sso) via IdP discovery (never hand-rolled).

```ts
import { createShelfAuth, ssoKeycloakPreset } from "@storyshelf/auth";

const shelf = createShelfAuth({
  db: database,
  secret: process.env.SECRET!,
  baseURL: process.env.PUBLIC_BASE_URL!,
  sso: {
    providers: [
      ssoKeycloakPreset("https://idp.example.com/realms/shelf", {
        domain: "example.com",
        clientId: "storyshelf",
        clientSecret: "{env:OIDC_CLIENT_SECRET}",
      }),
    ],
  },
});
```

Recipes: `ssoKeycloakPreset`, `ssoOktaPreset`, `ssoAuth0Preset`, `ssoGooglePreset`, `ssoEntraPreset`. Hand the IdP admin the callback URLs from `ssoCallbackUrls(baseURL, providerId)` (OIDC callback). SSO users link by email on first sign-in and keep existing shelf roles.

:::note
SSO providers are **code-driven recipes**. Runtime provider registration is blocked — there is no admin UI for adding an IdP.
:::

## IdP group sync

Recipes accept group options — synced on every sign-in (social and generic-OAuth logins have no per-login hook and never sync):

```ts
ssoKeycloakPreset("https://idp.example.com/realms/shelf", {
  domain: "example.com",
  clientId: "storyshelf",
  clientSecret: "{env:OIDC_CLIENT_SECRET}",
  groupsClaim: ["groups", "cognito:groups"],  // OIDC claim names (default ["groups"])
  adminGroups: ["shelf-admins"],               // exact match → site admin
})
```

- Claim values pass through as arrays; a lone string counts as one group (never whitespace-split). Matching is **exact** — no wildcards.
- Site role reconciles fully: admin-group members become `admin`, everyone else resets to `member` on each sign-in.
- Project memberships follow the Members-tab group mappings (highest rank wins, recorded as `sso:<group>`); stale synced grants are revoked while manual grants survive.

## Relying-party discovery

StoryShelf is an OIDC **relying party**, not a provider:

- `GET /.well-known/openid-configuration` — RP metadata (`issuer`, `code` flow, scopes, per-provider `redirect_uris`, provider list). Set `PUBLIC_BASE_URL` so the issuer is stable.
- `GET /.well-known/change-password` — redirects to `/profile`.

For SAML, see [SAML](/guides/auth/saml/); for generic config and secrets, see [Configuration](/guides/auth/configuration/).
