---
title: Auth configuration
description: Secrets, config-as-code, session settings, and login text.
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

Every logged-in user gets `/profile`: avatar, editable display name, email, site role, provider, project memberships, and sign-out — plus **Devices** (per-device revoke, sign out others), **Passkeys** (list, delete, register), and password change for local accounts. A user-edited display name survives IdP refresh (`display_name_override`).

See also [Auth concepts](../../concepts/auth/).
