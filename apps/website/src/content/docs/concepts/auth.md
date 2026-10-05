---
title: Auth concepts
description: How StoryShelf authenticates users — engine, sessions, invites, and per-branch memberships.
---

StoryShelf ships one auth engine — [`@storyshelf/auth`](../../packages/auth/) built on [Better Auth](https://www.better-auth.com/docs). [Better Auth](https://www.better-auth.com/docs) owns OIDC/SAML/WebAuthn wire protocols; StoryShelf owns `users`, `user_invite_tokens`, `project_members`, and the UI. Sessions are Better Auth DB rows under the `storyshelf_session` cookie (seven-day TTL, `cookieCache` off so revocation bites immediately). Engine identities mirror into the shelf `users` table with roles preserved — see the [Better Auth hooks](https://www.better-auth.com/docs/concepts/hooks#databasehooks) overview.

## Engine vs shelf

| Concern | Owner | Notes |
|---|---|---|
| `user` / `session` / `account` / `verification` / `passkey` / `ssoProvider` | Better Auth tables via opaque bridge | `DatabaseAdapter.transact?` gives atomic `consumeOne` / `incrementOne`; see [custom adapters](https://www.better-auth.com/docs/concepts/database#custom-adapters) |
| `users` / `user_invite_tokens` / `project_members` | StoryShelf | `users` is the source of truth for roles, memberships, `display_name_override` |
| Secrets | `resolveAuthOptions` + `{env:NAME}` refs | `process.env` first, then your `resolveSecrets` hook (Vault/AWS/GCP) |

## Login is descriptor-driven

`createShelfAuth({ db, secret, baseURL, social, oauth, sso, passkeys, plugins })` describes methods:

```ts
// each entry drives one widget on /auth/login
{ kind: "password" | "oauth" | "passkey" | "sso", id: string, label: string }
```

- `kind:"password"` → email/password form (`POST /auth/engine/login`).
- `kind:"oauth"` → one button per native social (`githubPreset`, `gitlabPreset`, etc. — [social providers](https://www.better-auth.com/docs/reference/social-providers)) or enterprise OIDC `keycloakPreset`/`oktaPreset`/`auth0Preset` via [generic OAuth](https://www.better-auth.com/docs/plugins/generic-oauth).
- `kind:"sso"` → domain-routed OIDC/SAML via the [SSO plugin](https://www.better-auth.com/docs/plugins/sso) (`ssoKeycloakPreset`, `samlPreset`).
- `kind:"passkey"` → WebAuthn button ([passkey plugin](https://www.better-auth.com/docs/plugins/passkey)) — needs HTTPS or `localhost`.

Adding a new provider is a preset (pure config) — no UI code. Sole `oauth`/`sso` method auto-redirects from `/auth/login` to the IdP.

## Sessions

- Better Auth session rows: `token` (raw), `token.signature` in the cookie, `expiresAt`, `ipAddress`, `userAgent`. See [session management](https://www.better-auth.com/docs/concepts/session-management#cookie-cache) and [session options](https://www.better-auth.com/docs/reference/options#session).
- `advanced.database.generateId` is ULID (shared with `users`), `advanced.cookies.session_token.name` is `storyshelf_session`. See [advanced options](https://www.better-auth.com/docs/reference/options#advanced).
- Mount: `app.all("/api/auth/*", shelf.handler)` — [Hono integration](https://www.better-auth.com/docs/integrations/hono). Login/profile pages call `shelf.api.getSession` server-side; `cookieCache` is off.

## Invite-only local accounts

No self-registration. Admins call `shelf.adapter.issueInvite({ email, name, role })` → one-time link `/auth/invites/<inviteId>?token=<token>` (relay out-of-band; fictional addresses like `front-desk@internal` work because emails are identifiers, not mailboxes). Tokens are `sha256`-hashed at rest, single-use, 7-day TTL, superseded on re-issue — re-invite is also password recovery. `acceptInvite` writes engine `user` + `credential` account rows directly with [Better Auth's hasher](https://www.better-auth.com/docs/concepts/email-and-password). Dev/fly servers bootstrap an env admin via `ensurePasswordAdmin` (`AUTH_PASSWORD` ≥12, `AUTH_EMAIL` optional).

## Passkeys

Enable with `passkeys: {}` — RP ID and origin derive from `baseURL`. Users enroll on `/profile` (register a 2nd key as backup) and sign in from login via `navigator.credentials` ceremonies (`passkey-ceremony.ts`). Passkeys need a secure context — the UI hides buttons on plain HTTP.

## Memberships and roles

First-seen engine users are upserted as `member` and group-synced per project; existing roles are never demoted. Project roles are `viewer`/`developer`/`approver`/`admin`; site `admin` bypasses project checks. See [Roles](../roles/).

## Pins

`better-auth@1.7.6`, `@better-auth/passkey@1.7.6`, `@better-auth/sso@1.7.6` — see the [changelog](https://www.better-auth.com/docs/changelog).
