# @storyshelf/auth-password

A shared-password auth adapter for StoryShelf: a single server-wide password gates access, and sessions are HMAC-signed cookies with a 7-day TTL.

## Install

```sh
nub add @storyshelf/auth-password
```

or

```sh
npm install @storyshelf/auth-password
```

## Quick start

```ts
import { createPasswordAuth } from "@storyshelf/auth-password";
import { createShelfRouter } from "@storyshelf/core";

const auth = createPasswordAuth({
  password: process.env.SHELF_PASSWORD!,
  secret: process.env.SHELF_SECRET!,
});

const app = createShelfRouter({ database, storage, auth });
```

## API

### `PasswordAuthOptions`

```ts
interface PasswordAuthOptions {
  password: string; // the shared password users must enter to log in
  secret: string;   // secret used to HMAC-sign session cookies
}
```

### `createPasswordAuth(options: PasswordAuthOptions): PasswordAuth`

Returns a `PasswordAuth`, which extends `AuthAdapter` with an extra method:

```ts
interface PasswordAuth extends AuthAdapter {
  login(password: string, user: AuthUser): Promise<string>;
}
```

- `login(password, user)` — throws if `password` does not match; otherwise creates an HMAC-signed session cookie string for the given `AuthUser`.
- `check(request)`, `createSession(user)`, `destroySession(sessionId)` — the standard `AuthAdapter` interface. Sessions last 7 days and are verified with timing-safe comparison.

## How it fits in

`auth-password` is the `auth` option for `createShelfRouter` when you want simple single-password protection for a self-hosted instance. When supplied, the router gates the server-rendered UI behind a login page and signs sessions with the shared secret.

See `docs/architecture.md` and ADR 0008.
