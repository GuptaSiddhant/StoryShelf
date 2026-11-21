---
title: Auth configuration
description: Secrets, config-as-code, session settings, login text and read-only shared accounts.
---

## Config-as-code and secrets

Engine options validate against shared zod schemas via `resolveAuthOptions` ([Better Auth `secret` docs](https://www.better-auth.com/docs/reference/options#secret)). Secrets stay out of code with `{env:NAME}` refs — resolved from `process.env` first, then your `resolveSecrets` hook for Vault/AWS/GCP:

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

Sessions are Better Auth DB rows under the `storyshelf_session` cookie (seven-day TTL, `cookieCache` off — see [cookie cache](https://www.better-auth.com/docs/concepts/session-management#cookie-cache)) mounted at `/api/auth/*` via the [Hono integration](https://www.better-auth.com/docs/integrations/hono). Engine identities mirror into `users` via [database hooks](https://www.better-auth.com/docs/concepts/hooks#databasehooks). See also [database adapters](https://www.better-auth.com/docs/concepts/database#custom-adapters).

## Custom login text

Reword the sign-in page without code via `ui.auth` (or `SHELF_AUTH_*` env vars on the dev/fly servers):

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

`publicLink: { href, label }` adds a secondary link under the form to something anyone may open without an account, such as a public build's Storybook (`/_/<project-slug>/`). `href` is an `https:` URL or a path on this server; nothing renders when it is unset. The link opens hosting only: a public build never opens review. On the dev and Fly servers it comes from `SHELF_AUTH_PUBLIC_LINK_URL` and `SHELF_AUTH_PUBLIC_LINK_LABEL`.

Available keys: `title`, `subtitle`, `passwordLabel`, `passwordPlaceholder`, `submitLabel`, `ssoLabelTemplate` (must contain `{label}`), `helpText`, `publicLink`, `footerText`. Page structure stays fixed — layout control remains via brand config.

## Profile

Every logged-in user gets `/profile`: avatar, editable display name, email, site role, provider, project memberships, and sign-out — plus **Devices** (per-device revoke, sign out others), **Passkeys** (list, delete, register), and password change for local accounts. A user-edited display name survives IdP refresh (`display_name_override`).

## Read-only shared accounts

A demo instance can publish the email and password of one account and still trust it: list the account in `readOnlyAccounts` and it may only sign in, sign out and read what its project role allows.

```ts
const shelf = createShelfAuth({
  ...authOptions,
  readOnlyAccounts: ["demo@example.com"],
});
```

The server image and the Fly app read the same list from `SHELF_READ_ONLY_ACCOUNTS` (comma-separated emails). Emails compare case-insensitively, and the list lives in configuration, never in the database.

Every write such an account attempts is refused with a `403` and one fixed message: the profile, password, devices, passkeys, notification settings, comments, verdicts, tokens and every other `POST`, `PUT`, `PATCH` or `DELETE` its role would allow. The app refuses its page and API routes in one middleware, whether the account arrives with its session or with a bearer token it owns, and the auth engine refuses its own endpoints (password change and reset, email change, profile update, account deletion, passkeys, session revocation). Pages show a quiet "Shared demo account: read-only" banner and hide the controls that would change something.

Give the account the `viewer` role on the projects it should see. Its password is still a credential: keep it out of logs and use a test domain in fixtures.

See also [Auth concepts](/concepts/auth/).
