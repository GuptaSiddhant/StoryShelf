---
title: Passkeys
description: WebAuthn passkeys via the Better Auth passkey plugin.
---

WebAuthn sign-in without passwords via the [passkey plugin](https://www.better-auth.com/docs/plugins/passkey).

Enable with `passkeys: {}` (RP ID and origin derive from `baseURL` — pin `PUBLIC_BASE_URL` so the origin is stable behind a proxy):

```ts
const shelf = createShelfAuth({
  db: database,
  secret: process.env.SECRET!,
  baseURL: process.env.PUBLIC_BASE_URL!,
  passkeys: {},
});
```

Users enroll keys on `/profile` (register a 2nd key as backup) and sign in from the login page.

## Requirements

- **Secure context:** `localhost` or HTTPS; browsers require `isSecureContext` + `PublicKeyCredential`. The UI hides passkey buttons on plain-HTTP hosts.
- **Origin stability:** RP ID defaults to the `baseURL` hostname; keep `PUBLIC_BASE_URL` stable when behind a reverse proxy.

See also [session management](https://www.better-auth.com/docs/concepts/session-management) and [Auth concepts](/concepts/auth/).

For other methods, see [Overview](/guides/auth/) and [Configuration](/guides/auth/configuration/).
