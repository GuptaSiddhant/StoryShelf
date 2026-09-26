---
title: "@storyshelf/auth-password"
description: Protect a StoryShelf instance with a shared password or invite-only local accounts.
---

`@storyshelf/auth-password` adds password authentication for small teams and trusted self-hosted deployments: one server-wide shared password and/or per-user local accounts onboarded via invite links. Sessions are HMAC-signed cookies with a seven-day TTL.

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

## Invite-only local accounts

`createAccountAuth({ db, secret, inviteExpiryMs? })` manages per-user email/password accounts without an IdP or SMTP. Admins invite any syntactically-valid email (deliverability is never checked, so fictional/internal addresses work) and relay the one-time link out-of-band:

```ts
import { createAccountAuth } from "@storyshelf/auth-password";

const auth = createAccountAuth({ db, secret: process.env.SHELF_SECRET! });
const { inviteId, token } = await auth.issueInvite({
  email: "ada@example.com",
  name: "Ada",
  role: "member",
});
// → /auth/invites/<inviteId>?token=<token>
```

- `issueInvite` creates the user if needed, supersedes prior unused invites, and returns the token shown once. **Re-invite is the password-recovery flow** — there are no temporary passwords.
- `acceptInvite` is single-use with a 7-day expiry (configurable via `inviteExpiryMs`) and generic errors on any invalid/expired/reused token. Minimum password length is 12.
- `loginWithCredentials` answers generic "Invalid credentials" (no user enumeration); `changePassword` and `setDisabled` cover self-service and admin management.
- Passwords are scrypt-hashed (`node:crypto` only); invite tokens are sha256-hashed at rest.

:::note
Local emails are **identifiers, not mailboxes**: no verification step, and self-service email reset can never reach a fictional address. Recovery is always admin re-invite.
:::

Combine shared password, local accounts, and OIDC providers in one install with `createMultiAuth` — see [Multiple methods](../../guides/auth/#multiple-methods).
