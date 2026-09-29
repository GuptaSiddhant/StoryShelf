---
title: Auth
description: Secure your StoryShelf instance with local accounts, social login, enterprise SSO/SAML, or passkeys.
---

Auth is a pluggable adapter. StoryShelf ships one engine implementation — `@storyshelf/auth` (`createShelfAuth`) — with five login methods: **none** (default, for trusted networks), **local accounts** (invite-only email/password, no IdP needed), **social login** (GitHub, GitLab, Google, Microsoft, Cognito), **enterprise SSO** (OIDC discovery + SAML), and **passkeys** (WebAuthn). The login page renders one widget per configured method.

## None (default)

With no auth configured, the web UI is open and project roles are not enforced. This is fine for:

- Local development (`storyshelf-server serve`).
- A demo or internal deployment behind a VPN.

:::caution
Do not expose an auth-less instance directly to the public internet — anyone can review, approve, or reject builds.
:::

## Local accounts (invite-only)

For teams without an identity provider, the engine manages per-user email/password accounts. Admins invite an address; the user opens a one-time link, sets a password, and is signed in:

```ts
import { createShelfAuth } from "@storyshelf/auth";

const shelf = createShelfAuth({
  db: database,
  secret: process.env.SECRET!,
  baseURL: process.env.PUBLIC_BASE_URL!,
  passkeys: {},
});
const app = createShelfApp({ database, storage, auth: shelf.adapter });

// Invite (admin): relay one URL out-of-band: /auth/invites/<inviteId>?token=<token>
const { inviteId, token } = await shelf.adapter.issueInvite({
  email: "ada@example.com",
  name: "Ada",
  role: "member",
});
```

- Invite links are single-use, expire after 7 days, are stored hashed, and are superseded when re-issued — **re-invite is also the password-recovery flow**.
- There are **no temporary passwords**: nothing to shoulder-surf in the admin UI.
- Login failures are generic ("Invalid credentials") to avoid user enumeration.

:::note
Local emails are **identifiers, not mailboxes**. Deliverability is never checked, so fictional or future addresses (`front-desk@internal`) work — but self-service email reset can never reach them. Recovery is always admin re-invite.
:::

### Dev servers: env-driven admin

`apps/dev-server` and `apps/fly-app` provision a local admin from the environment on every boot (replacing the retired shared-password tier):

```bash
AUTH_PASSWORD=a-long-admin-password   # at least 12 characters
AUTH_EMAIL=admin@local                # optional, defaults to admin@local
SECRET=your-session-secret
```

## Secrets

`SECRET` signs session cookies — generate once, keep stable:

```bash
SECRET=$(openssl rand -hex 32)   # ≥ 32 characters, required at boot
```

Never reuse `SECRET` for `STORYSHELF_ADMIN_TOKEN` (site-admin bearer) — it grants project creation and purge without a session.

## Invite playbook (local accounts)

1. Admin (server or `POST` via `STORYSHELF_ADMIN_TOKEN`) calls `shelf.adapter.issueInvite({ email, name, role })`.
2. Copy the one-time URL `/auth/invites/<inviteId>?token=<token>` and relay it out-of-band (Slack, email, 1:1 — no SMTP in StoryShelf).
3. User opens the link, sets a password (≥ 12), and is auto-signed-in to `/profile`.
4. Expired or superseded links show “Invalid or expired invite”; generic “Invalid credentials” on login avoids enumeration. Re-invite to recover.

## Social login

Native provider integrations (PKCE, token exchange, and profile mapping owned by [Better Auth](https://www.better-auth.com/docs/reference/social-providers) — see [OAuth concepts](https://www.better-auth.com/docs/concepts/oauth)) via one-line recipes:

```ts
import { createShelfAuth, githubPreset, googlePreset } from "@storyshelf/auth";

const shelf = createShelfAuth({
  db: database,
  secret: process.env.SECRET!,
  baseURL: process.env.PUBLIC_BASE_URL!,
  social: [
    githubPreset({ clientId: "...", clientSecret: "{env:GITHUB_CLIENT_SECRET}" }),
    googlePreset({ clientId: "...", clientSecret: "{env:GOOGLE_CLIENT_SECRET}" }),
  ],
});
```

Available: [`githubPreset`](https://www.better-auth.com/docs/reference/social-providers), [`gitlabPreset`](https://www.better-auth.com/docs/reference/social-providers) (plus `issuer` for self-managed instances), [`googlePreset`](https://www.better-auth.com/docs/reference/social-providers), [`entraPreset`](https://www.better-auth.com/docs/reference/social-providers) (plus `tenantId`), [`cognitoPreset`](https://www.better-auth.com/docs/reference/social-providers) (`domain`/`region`/`userPoolId`).

## Enterprise SSO (OIDC + SAML)

Domain-routed enterprise login through the [SSO plugin](https://www.better-auth.com/docs/plugins/sso) — OIDC via IdP discovery, SAML via samlify (never hand-rolled XML):

```ts
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

OIDC recipes: `ssoKeycloakPreset`, `ssoOktaPreset`, `ssoAuth0Preset`, `ssoGooglePreset`, `ssoEntraPreset`. Hand the IdP admin the callback URLs from `ssoCallbackUrls(baseURL, providerId)` (ACS, SP metadata, OIDC callback). SSO users link by email on first sign-in and keep their existing shelf roles.

:::note
SSO providers are **code-driven recipes**. Runtime provider registration is blocked — there is no admin UI for adding an IdP.
:::

### IdP group sync

SSO recipes accept group options — synced on every sign-in (social and generic-OAuth logins have no per-login hook and never sync):

```ts
ssoKeycloakPreset("https://idp.example.com/realms/shelf", {
  domain: "example.com",
  clientId: "storyshelf",
  clientSecret: "{env:OIDC_CLIENT_SECRET}",
  groupsClaim: ["groups", "cognito:groups"],  // OIDC claim names (default ["groups"])
  adminGroups: ["shelf-admins"],               // exact match → site admin
}),
samlPreset({
  // ...
  groupsAttribute: "http://schemas.example.com/groups",  // SAML attribute (default "groups")
  adminGroups: ["Acme Admins"],
}),
```

- Claim values pass through as arrays; a lone string counts as one group (never whitespace-split). Matching is **exact** — no wildcards.
- Site role reconciles fully: admin-group members become `admin`, everyone else resets to `member` on each SSO sign-in.
- Project memberships follow the Members-tab group mappings (highest rank wins, recorded as `sso:<group>`); stale synced grants are revoked while manual grants survive.

## Passkeys

WebAuthn sign-in without passwords via the [passkey plugin](https://www.better-auth.com/docs/plugins/passkey). Enable with `passkeys: {}` (RP ID and origin derive from `baseURL` — pin `PUBLIC_BASE_URL` so the origin is stable behind a proxy); users enroll keys on `/profile` (register a 2nd key as backup) and sign in from the login page. Passkeys need a secure context — `localhost` or HTTPS; browsers require `isSecureContext` + `PublicKeyCredential` — the UI hides passkey buttons on plain-HTTP hosts. See also [session management](https://www.better-auth.com/docs/concepts/session-management).

## Config-as-code and secrets

Engine options validate against shared zod schemas via `resolveAuthOptions` ([Better Auth `secret` docs](https://www.better-auth.com/docs/reference/options#secret)). Secrets stay out of code with `{env:NAME}` refs — resolved from `process.env` first, then your `resolveSecrets` hook for Vault/AWS/GCP:

Sessions are Better Auth DB rows under the `storyshelf_session` cookie (seven-day TTL, `cookieCache` off — see [cookie cache](https://www.better-auth.com/docs/concepts/session-management#cookie-cache)) mounted at `/api/auth/*` via the [Hono integration](https://www.better-auth.com/docs/integrations/hono). Engine identities mirror into `users` via [database hooks](https://www.better-auth.com/docs/concepts/hooks#databasehooks). See also [database adapters](https://www.better-auth.com/docs/concepts/database#custom-adapters).

```ts
import { resolveAuthOptions } from "@storyshelf/auth";

const authOptions = await resolveAuthOptions({
  db: database,
  secret: "{env:SECRET}",
  baseURL: process.env.PUBLIC_BASE_URL!,
  sso: { providers: [...] },
  resolveSecrets: async (names) => vault.read(names),
});
const shelf = createShelfAuth(authOptions);
```

Precedence: explicit literal > `{env}` ref > schema default; code recipes > DB rows > plugin defaults at sign-in.

## Custom login text

Reword the sign-in page without code via `ui.auth` (or `SS_AUTH_*` env vars on the dev/fly servers):

```ts
const app = createShelfApp({
  ...,
  ui: {
    auth: {
      title: "Welcome back",
      subtitle: "Sign in to review visual changes",
      ssoLabelTemplate: "Continue with {label}",
      helpText: "Use your company SSO. Need access? Ask in #design-systems.",
    },
  },
});
```

Available keys: `title`, `subtitle`, `passwordLabel`, `passwordPlaceholder`, `submitLabel`, `ssoLabelTemplate` (must contain `{label}`), `helpText`, `footerText`. Page structure stays fixed — layout control remains via brand config.

## Profile

Every logged-in user gets `/profile` (linked from the header menu): avatar, editable display name, email, site role, provider, project memberships, and sign-out — plus **Devices** (per-device revoke, sign out others), **Passkeys** (list, delete, register), and password change for local accounts. A user-edited display name survives IdP refresh (`display_name_override`).

## Relying-party discovery

StoryShelf is an OIDC **relying party**, not a provider. Two public helpers ease IdP registration:

- `GET /.well-known/openid-configuration` — RP metadata (issuer, `code` flow, scopes, per-provider `redirect_uris`, provider list), explicitly labelled as such. Set `PUBLIC_BASE_URL` (or `config.publicBaseUrl`) so the issuer is stable; otherwise the request origin is used.
- `GET /.well-known/change-password` — redirects to `/profile`.

## Project roles

Auth enables project-scoped roles, tracked per project via membership:

| Role | Capabilities |
|------|--------------|
| `viewer` | View builds, diffs, and published Storybooks |
| `developer` | View + upload builds |
| `approver` | View + approve/reject snapshots |
| `admin` | Full control, including members and settings |

Site-wide roles are `admin` and `member`. Site `admin` users bypass project roles entirely. For a public deployment, restrict access by granting roles through project settings.

## First admin bootstrap

With auth enabled and an empty database, no one can log in as admin yet. Set `STORYSHELF_ADMIN_TOKEN` (or `ADMIN_TOKEN`) on the server: its bearer value grants site-admin API access (project creation, purge) without a session. It never mints sessions and is distinct from `SECRET` (session signing). Creating a project as a logged-in user also records them as that project's admin.

## API tokens vs. user auth

Auth gates the **web UI**. The **CLI does not use user login** — it authenticates with **per-project API tokens** sent as `Authorization: Bearer <token>` (CI, `STORYSHELF_TOKEN`) and **site-admin tokens** (`STORYSHELF_ADMIN_TOKEN`) for project creation. Tokens are bound to the user who mints them and resolve to that user's live project role, so bearer callers pass the same role requirements as sessions; demoting a user instantly downgrades their tokens. Legacy tokens minted before user binding resolve as viewer, and tokens whose owner was deleted are denied — re-issue them. Tokens are minted by [`storyshelf create`](/guides/cli/) (requires admin token, writes `.storybook/storyshelf.json`) or in project settings; client config alone can be initialized via [`storyshelf init`](/guides/cli/).

## Public Storybooks

Published Storybooks can be made viewable **without auth** when their branch matches the project's `public_branch_regex` (e.g. `^main$` or `^release-`) or when a build is explicitly marked public. Every other Storybook requires auth and at least `viewer` membership. This lets you share component previews with stakeholders who don't have accounts.
