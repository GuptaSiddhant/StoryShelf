# ADR 0021: Composite Auth, Custom Login Text, Invite-Only Local Accounts, Profile, and RP Discovery

## Status

Accepted. Extends ADR 0008 (auth as a pluggable adapter), which remains the base contract.

## Context

ADR 0008 made auth pluggable but left four gaps, confirmed against real deployments:

1. **One method only.** `ShelfOptions.auth` accepted a single `AuthAdapter`, so operators could not combine the shared password with OIDC, or several OIDC providers side by side.
2. **Fixed login UI.** The sign-in page had hardcoded English strings and one SSO button slot.
3. **Impersonal sessions.** The header showed a name/role chip with no personal page; shared-password logins wrote no `users` row at all.
4. **No discovery helpers.** Operators registering StoryShelf with their IdP had to hand-assemble redirect URIs; there was no standard change-password slot.
5. **No local accounts.** Teams without an IdP could only share one password — no per-user email/password identities with roles.

## Decision

### 1. Composite multi-auth (`core/adapter/multi-auth`)

`createMultiAuth({ secret, methods: [{ id, label, adapter }] })` fans out over several login methods. Sessions are signed once with the composite `secret`; member `check` fallbacks stay so pre-upgrade cookies keep working until re-login. `AuthUser.providerId` / `AuthCallback.providerId` route identities and callbacks to the minting method.

Routes: `/auth/login/:id` starts a flow, `/auth/callback/:id` finishes it (per-method anti-CSRF state cookies); the legacy `/auth/callback` remains as an alias iff exactly one OIDC method exists. The health snapshot expands to `auth:<id>` per method. Single-adapter configs keep working unchanged.

### 2. Custom login text (`UIConfig.auth`, no render hook)

`ui.auth` carries text overrides (title, subtitle, password label/placeholder, submit label, `{label}` SSO template, help/footer). Structure stays fixed — full layout control remains via brand config. Deliberately no custom-component hook: the login page is security-sensitive chrome, and a hook would fork its maintenance.

### 3. Invite-only local accounts (`createAccountAuth` in `@storyshelf/auth-password`)

A second factory next to `createPasswordAuth` (same package, same `"."` entry; distinct method names so router capability-sniffing stays unambiguous). Admins invite any syntactically-valid email — deliverability is never checked, so fictional/internal addresses work. The invite is a one-time link (`/auth/invites/:id`, 7-day expiry, sha256 at rest, superseded on re-issue); the user sets their own password. **No temporary passwords exist anywhere**: nothing to shoulder-surf, and recovery is re-invite. Passwords are scrypt-hashed (`node:crypto`, zero deps); login errors are generic to avoid user enumeration.

Local emails are **identifiers, not mailboxes**: no verification step, no SMTP, self-service email reset is out of scope.

### 4. Personal profile (`/profile`, `display_name_override`)

Avatar, editable display name, email, site role, provider, groups, memberships, session note, sign-out, plus change-password for local accounts. OIDC refresh preserves a user-edited name via `users.display_name_override`; shared-password logins now upsert a `users` row so every session has a stable editable identity.

### 5. Relying-party discovery (`/.well-known/*`, `ShelfConfig.publicBaseUrl`)

StoryShelf is an RP, not an IdP, and the served document says so: `openid-configuration` returns RP helper metadata (issuer, `code` flow, scopes, per-provider `redirect_uris`, provider list) for operators registering with their IdP. `change-password` 302s to `/profile`. Both are auth-gate-exempt. `publicBaseUrl` (or `PUBLIC_BASE_URL`) pins the issuer; otherwise the request origin is used.

## Consequences

**Positive:** password + N OIDC in one install; self-hosters rebrand login via env; every user gets a personal page; IdP registration is copy-paste; teams without an IdP get real accounts without email infrastructure.

**Negative:** composite sessions invalidate on upgrade (old member-signed cookies fall back to member `check`, then require re-login); sessions stay stateless, so there is no server-side session list ("sign out everywhere" = rotate `SECRET`); invite links are bearer credentials until used (short expiry + single use mitigate).
