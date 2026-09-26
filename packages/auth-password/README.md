# @storyshelf/auth-password

Password auth adapters for StoryShelf: a shared password and invite-only local accounts. Sessions are HMAC-signed cookies with a 7-day TTL.

This package holds two factories (same entry, distinct method names so routers can capability-sniff them):

- `createPasswordAuth` — one server-wide shared password (optionally tiered admin/viewer).
- `createAccountAuth` — per-user email/password accounts onboarded via one-time invite links. No IdP or SMTP needed.

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
import { createShelfApp } from "@storyshelf/app";

const auth = createPasswordAuth({
  password: process.env.SHELF_PASSWORD!,
  secret: process.env.SHELF_SECRET!,
});

const app = createShelfApp({ database, storage, auth });
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

## Invite-only local accounts

```ts
import { createAccountAuth } from "@storyshelf/auth-password";

const auth = createAccountAuth({ db, secret: process.env.SHELF_SECRET! });

// Admin invites any syntactically-valid email (deliverability never checked,
// so fictional/internal addresses work). Relay the link out-of-band.
const { inviteId, token } = await auth.issueInvite({
  email: "ada@example.com",
  name: "Ada",
  role: "member",
});
// → /auth/invites/<inviteId>?token=<token>
```

- `issueInvite({ email, name, role })` — creates the user if needed, supersedes prior unused invites, returns the one-time token (shown once). Re-inviting is also the recovery flow.
- `acceptInvite({ inviteId, token, password })` — single-use, 7-day expiry, generic errors on any invalid/expired/reused token. Minimum password length is 12.
- `loginWithCredentials(email, password)` — generic "Invalid credentials" on unknown email, wrong password, disabled, or missing hash.
- `changePassword({ userId, currentPassword, newPassword })`, `setDisabled(userId, disabled)` — self-service and admin management.
- Passwords are scrypt-hashed (`password-hash.ts`, `node:crypto` only). `check` rejects disabled accounts and surfaces `displayNameOverride`.

Local emails are identifiers, not mailboxes: no verification step, no SMTP. See the Auth guide on the website and ADR 0021 (`docs/adr/0021-composite-auth-and-local-accounts.md`).

## How it fits in

`auth-password` is the `auth` option for `createShelfApp` when you want password protection for a self-hosted instance — shared, accounts, or both combined via `createMultiAuth`. When supplied, the router gates the server-rendered UI behind a login page and signs sessions with the shared secret.

See `docs/architecture.md` and ADRs 0008/0021.
