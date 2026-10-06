# Migrating to the Better Auth engine

The legacy auth packages (`@storyshelf/auth-password`, `@storyshelf/auth-oauth`)
are deleted. All installs use `@storyshelf/auth` (`createShelfAuth`),
which owns OIDC/SAML/WebAuthn wire protocols via Better Auth while StoryShelf
keeps users, memberships, invites, and UI. See ADR 0023.

## What breaks

- **Shared-password tier is gone** — no `createPasswordAuth`, no viewer tier,
  no `AUTH_VIEWER_PASSWORD`. Dev/demo servers provision an env-driven admin
  instead (see below).
- **Local password hashes are incompatible** — scrypt hashes cannot be verified
  by the engine. Every local user must be **re-invited** (invite accept sets a
  fresh engine credential).
- **All sessions are revoked** — plan a forced re-login window. Cookie name is
  unchanged (`storyshelf_session`), but sessions now live in engine tables.
- **OAuth users keep working** — the engine links by email on next sign-in and
  mirrors the existing shelf row (roles preserved, never demoted).
- **IdP group sync** is configured per SSO recipe (`groupsClaim` /
  `groupsAttribute` + `adminGroups`): site `admin` on match (full reconcile
  to `member` otherwise), project memberships from the Members-tab group
  mappings (highest rank wins, recorded as `sso:<group>`; manual grants
  survive). No `viewerGroups` equivalent — site roles are `admin`/`member`.
- **`storyshelf server init` output changed** — `password` scaffolds email/pass
  + `ensurePasswordAdmin` bootstrap; `oauth` on AWS scaffolds the `cognitoPreset`
  social (new `COGNITO_DOMAIN` env); otherwise the `keycloakPreset` recipe.

## Environment changes

| Before | After |
|---|---|
| `AUTH_PASSWORD` (shared login, any length) | `AUTH_PASSWORD` (local admin bootstrap, **≥ 12 chars**) |
| `AUTH_VIEWER_PASSWORD` | Removed (no viewer tier) |
| — | `AUTH_EMAIL` (admin address, default `admin@example.com`) |
| `SECRET` | `SECRET` (unchanged, still required with auth) |
| `OIDC_ISSUER` / `OIDC_REDIRECT_URL` | Recipe-specific (e.g. `OIDC_ISSUER` = realm URL for `keycloakPreset`; `COGNITO_DOMAIN`/`COGNITO_REGION`/`COGNITO_USER_POOL_ID` for `cognitoPreset`) |

## Database migration

New engine tables auto-migrate on boot (`IF NOT EXISTS`, no action needed):

- sqlite / Turso: `user`, `session`, `account`, `verification`, `passkey`, `ssoProvider`
- Postgres: same six tables in `db-postgres` DDL (fresh installs migrate; existing
  installs pick them up on next boot)

Dual-driver verification checklist (run before promoting the deploy):

1. Boot against a copy of production data; confirm all six tables exist.
2. Sign in once per configured method; confirm the shelf `users` row keeps its role.
3. Accept one invite end to end; confirm auto-sign-in lands on `/profile`.
4. Register + use one passkey; revoke one session from `/profile` Devices.
5. Confirm old session cookies no longer authenticate (forced re-login).

## Code migration

```ts
// Before
import { createPasswordAuth } from "@storyshelf/auth-password";
import { createOAuthAuth, cognitoPreset } from "@storyshelf/auth-oauth";
const auth = createPasswordAuth({ password: process.env.AUTH_PASSWORD! });

// After: local accounts + invite flow
import { createShelfAuth, ensurePasswordAdmin } from "@storyshelf/auth";
const shelf = createShelfAuth({
  db: database,
  secret: process.env.SECRET!,
  baseURL: process.env.PUBLIC_BASE_URL!,
  passkeys: {},
});
await ensurePasswordAdmin(database, {
  email: process.env.AUTH_EMAIL ?? "admin@example.com",
  password: process.env.AUTH_PASSWORD!,
});
const app = createShelfApp({ database, storage, auth: shelf.adapter });
```

```ts
// After: enterprise SSO (domain-routed OIDC + SAML)
import { createShelfAuth, ssoKeycloakPreset, samlPreset } from "@storyshelf/auth";
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
      samlPreset({
        id: "acme-saml",
        domain: "example.com",
        issuer: process.env.PUBLIC_BASE_URL!,
        entryPoint: "https://idp.example.com/sso",
        metadataXml: "{env:SAML_METADATA}",
      }),
    ],
  },
});
```

Secrets stay out of code via `{env:NAME}` refs (resolved from `process.env`,
then your `resolveSecrets` hook for Vault/AWS/GCP) — see `resolveAuthOptions`.

## Exact pins

- `better-auth@1.7.6`, `@better-auth/passkey@1.7.6`, `@better-auth/sso@1.7.6`
- Session cookie: `storyshelf_session`, 7-day TTL, no cookie cache (revocation
  and disabled-user checks bite immediately)
