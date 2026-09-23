---
title: "@storyshelf/auth-password"
description: Protect a StoryShelf instance with one shared password.
---

`@storyshelf/auth-password` adds simple server-wide password authentication for small teams and trusted self-hosted deployments. Sessions are HMAC-signed cookies with a seven-day TTL.

## Install

```sh
nub add @storyshelf/auth-password
```

[![JSR](https://jsr.io/badges/@storyshelf/auth-password)](https://jsr.io/@storyshelf/auth-password) [![JSR Score](https://jsr.io/badges/@storyshelf/auth-password/score)](https://jsr.io/@storyshelf/auth-password)

- [npm package](https://www.npmjs.com/package/@storyshelf/auth-password) — install tarballs and version history.
- [JSR package](https://jsr.io/@storyshelf/auth-password) — TypeScript-first registry page.
- [Public API reference](https://jsr.io/@storyshelf/auth-password/doc) — generated docs for every export; start here to learn the API.
- [Source on GitHub](https://github.com/GuptaSiddhant/storyshelf/tree/main/packages/auth-password) — package directory on `main`.

## Configure

```ts
import { createPasswordAuth } from "@storyshelf/auth-password";

// Single shared password (admin only)
const auth = createPasswordAuth({
  password: process.env.SHELF_PASSWORD!,
  secret: process.env.SHELF_SECRET!,
});

const app = createShelfApp({ database, storage, auth });
```

Both `password` and `secret` are required. The password is compared securely (`timingSafeEqual`); the secret signs and verifies session cookies.

### Tiered demo (admin + viewer)

For a public demo that is **open for viewers but not editors**, add an optional viewer password:

```ts
import { createPasswordAuth } from "@storyshelf/auth-password";

const auth = createPasswordAuth({
  password: process.env.SHELF_PASSWORD!,       // admin
  viewerPassword: process.env.SHELF_VIEWER_PASSWORD!, // viewer (read-only)
  secret: process.env.SHELF_SECRET!,
});
```

- `password` → `admin` (full control)
- `viewerPassword` → `viewer` (read all projects, cannot mutate, manage, or administer — site `viewer` role, see [Roles & tokens](../../concepts/roles/))

When `viewerPassword` is omitted, the adapter stays single-password (admin only) — existing installs keep working. Use `AUTH_PASSWORD` + `AUTH_VIEWER_PASSWORD` in `apps/dev-server` and `apps/fly-app` (see `server.ts` wiring) and publish the viewer password to demo users.

:::note
If `viewerPassword` equals `password`, the admin tier wins — viewer login would mint an admin session. Keep them distinct.
:::

## API

`createPasswordAuth(options: { password, viewerPassword?, secret })` returns an `AuthAdapter` with `login(password, user?)`, `check(request)`, `createSession(user)`, and `destroySession(sessionId)`. `login` rejects an incorrect password and returns a signed session cookie for the matching tier (`admin` or `viewer`). The optional second arg `user` is kept for backward compat — when `viewerPassword` is set the adapter mints its built-in `shared` / `shared-viewer` users automatically. Liveness fails fast if `password`/`secret` (or `viewerPassword` when set) is empty.

Use this adapter when one (or two tiered) shared logins are enough. For identity-provider login, use [OAuth/OIDC authentication](../auth-oauth/) instead. The broader auth modes and project roles are covered in the [authentication guide](../../guides/auth/). For a live demo with viewer-open access see the [Live Demo guide](../../guides/demo/).
