# ADR 0023: Wholesale Better Auth Engine

## Status

Accepted. Supersedes ADR 0021 (composite multi-auth, shared password, legacy
OIDC adapter) and extends ADR 0008 (auth stays pluggable; the engine is one
pluggable implementation, not a core dependency).

## Context

ADR 0008 made auth a pluggable adapter; ADR 0021 composed password, local
accounts, and hand-rolled OIDC behind `createMultiAuth`. That containment
strategy hit its limits:

1. **Protocol surface.** OIDC discovery, PKCE, SAML (AuthnRequest, assertion
   validation, SLO), and WebAuthn ceremonies are security-critical wire
   protocols. Hand-rolling them per adapter is an audit liability.
2. **Method sprawl.** Each login method re-implemented sessions, cookies,
   CSRF state, and revocation. Five auth packages duplicated the hardest parts.
3. **Secret handling.** Client secrets, IdP certs, and SAML metadata lived in
   adapter options with no validated, secret-safe config story.

## Decision

Go wholesale on Better Auth, lean core:

- **Better Auth owns OIDC/SAML/WebAuthn wire protocols** ([`better-auth@1.7.6`](https://www.better-auth.com/docs), [`@better-auth/passkey@1.7.6`](https://www.better-auth.com/docs/plugins/passkey), [`@better-auth/sso@1.7.6`](https://www.better-auth.com/docs/plugins/sso), samlify via the SSO plugin — never hand-rolled XML; see [Hono integration](https://www.better-auth.com/docs/integrations/hono)).
- **StoryShelf owns users, memberships, invites, and UI.** Engine identities
   mirror into the shelf `users` table (source of truth for roles) via [database hooks](https://www.better-auth.com/docs/concepts/hooks#databasehooks); all logins
   flow through engine endpoints mounted at `/api/auth/*`.
- **Core gains one optional method** (`DatabaseAdapter.transact?`); the opaque
  `DBAdapter` bridge in `@storyshelf/auth` maps engine models onto
  shelf tables with zero dialect knowledge (sqlite, Turso, Postgres fragments).
- **Config-as-code:** validated zod schemas, `{env:NAME}` secret refs
  (`process.env` first, customer-owned `resolveSecrets` hook for
  Vault/AWS/GCP), explicit > ref > default precedence; code (`defaultSSO`,
  recipes) > DB rows > plugin defaults at sign-in.
- **Breaking:** the shared-password tier and `@storyshelf/auth-password` /
  `@storyshelf/auth-oauth` are deleted; local password hashes are incompatible
  (re-invite); all sessions are revoked. See `docs/migration-auth-engine.md`.

## Consequences

- Login methods are descriptors (`password`, `oauth`, `passkey`, `sso`) driving
  one login page; custom plugins must not shadow shelf-reserved engine paths
  (boot-time guard) and method ids must be unique (boot-time guard).
- Runtime SSO provider management is blocked (`disabledPaths`); providers are
  code-driven recipes.
- IdP group sync has no engine equivalent yet (deferred); site roles are
  assigned manually or via invite roles.
- Passkeys need a secure context (`localhost` or HTTPS); the UI hides passkey
  affordances otherwise.
