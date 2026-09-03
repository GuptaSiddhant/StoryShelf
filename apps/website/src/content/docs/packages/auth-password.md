---
title: "@storyshelf/auth-password"
description: Protect a StoryShelf instance with one shared password.
---

`@storyshelf/auth-password` adds simple server-wide password authentication for small teams and trusted self-hosted deployments. Sessions are HMAC-signed cookies with a seven-day TTL.

## Install

```sh
nub add @storyshelf/auth-password
```

## Configure

```ts
import { createPasswordAuth } from "@storyshelf/auth-password";

const auth = createPasswordAuth({
  password: process.env.SHELF_PASSWORD!,
  secret: process.env.SHELF_SECRET!,
});

const app = createShelfRouter({ database, storage, auth });
```

Both `password` and `secret` are required. The password is compared securely; the secret signs and verifies session cookies.

## API

`createPasswordAuth(options)` returns an `AuthAdapter` with `login(password, user)`, `check(request)`, `createSession(user)`, and `destroySession(sessionId)`. `login` rejects an incorrect password and returns a signed session cookie for a valid user.

Use this adapter when one shared login is enough. For identity-provider login, use [OAuth/OIDC authentication](../auth-oauth/) instead. The broader auth modes and project roles are covered in the [authentication guide](../../guides/auth/).
