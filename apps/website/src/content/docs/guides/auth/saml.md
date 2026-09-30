---
title: SAML
description: SAML via the Better Auth SSO plugin and samlify.
---

SAML through the [SSO plugin](https://www.better-auth.com/docs/plugins/sso) via [samlify](https://www.better-auth.com/docs/plugins/sso) (never hand-rolled XML).

```ts
import { createShelfAuth, samlPreset } from "@storyshelf/auth";

const shelf = createShelfAuth({
  db: database,
  secret: process.env.SECRET!,
  baseURL: process.env.PUBLIC_BASE_URL!,
  sso: {
    providers: [
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

Hand the IdP admin the callback URLs from `ssoCallbackUrls(baseURL, providerId)` (ACS, SP metadata). Users link by email on first sign-in.

:::note
SSO providers are **code-driven recipes**. Runtime provider registration is blocked — there is no admin UI for adding an IdP.
:::

## Group sync

```ts
samlPreset({
  // ...
  groupsAttribute: "http://schemas.example.com/groups",  // SAML attribute (default "groups")
  adminGroups: ["Acme Admins"],
})
```

Same reconcile rules as [OIDC](/guides/auth/oidc/): exact match, site `admin` ↔ `member` on every sign-in, `sso:<group>` project grants, manual grants survive.

For OIDC discovery, see [OIDC](/guides/auth/oidc/); for secrets and precedence, see [Configuration](/guides/auth/configuration/).
