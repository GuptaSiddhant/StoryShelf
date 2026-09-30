---
title: Social login
description: One-line social presets for GitHub, GitLab, Google, Microsoft, and Cognito.
---

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

Available:

- [`githubPreset`](https://www.better-auth.com/docs/reference/social-providers)
- [`gitlabPreset`](https://www.better-auth.com/docs/reference/social-providers) (+ `issuer` for self-managed instances)
- [`googlePreset`](https://www.better-auth.com/docs/reference/social-providers)
- [`entraPreset`](https://www.better-auth.com/docs/reference/social-providers) (+ `tenantId` for Entra)
- [`cognitoPreset`](https://www.better-auth.com/docs/reference/social-providers) (`domain` / `region` / `userPoolId`)

Secrets stay out of code with `{env:NAME}` refs — see [Configuration](./configuration/). Each preset adds one `oauth` widget on `/auth/login` (sole method auto-redirects to the IdP).

Users link by email on first sign-in and keep existing shelf roles. For OIDC discovery and SAML, see [OIDC](./oidc/) and [SAML](./saml/).
