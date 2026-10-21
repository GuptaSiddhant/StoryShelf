# ADR 0011: Authentication and Access

## Status

Accepted.

Supersedes (archived): ADR 0008, 0021, 0023, 0030.

## Context

StoryShelf is self-hosted. It may run behind a VPN with no login at all, be exposed publicly, or sit
inside an enterprise that already has an identity provider (Keycloak, Authentik, Okta, Cognito,
GitHub, Google, a SAML IdP). Enterprise installs should use the organization's existing identity,
not a proprietary one, and teams without an IdP still need real per-user accounts.

Two concerns are separate:

1. **Web sessions:** who is the signed-in person, and what may they do on which project.
2. **CLI and API tokens:** which project an upload or API call belongs to.

OIDC discovery, PKCE, SAML (AuthnRequest, assertion validation, single logout) and WebAuthn
ceremonies are security-critical wire protocols. Hand-rolling them per login method duplicates the
hardest parts (sessions, cookies, CSRF state, revocation) and is an audit liability.

Some adapters also need a person's own credential for a third-party service (a member's Figma
access for design previews, later Jira or Linear), which calls for one service-neutral
"Connect your account" flow rather than one per adapter.

## Decision

### 1. Auth stays optional and pluggable; Better Auth is the engine

`ShelfOptions.auth` takes an auth adapter. The app never imports a concrete auth implementation.
The one implementation shipped is `@storyshelf/auth` (`createShelfAuth`), built on Better Auth
(`better-auth@1.7.6`, `@better-auth/passkey@1.7.6`, `@better-auth/sso@1.7.6`, samlify through the
SSO plugin).

- **Better Auth owns the wire protocols:** OIDC, OAuth social logins, SAML and WebAuthn. No XML or
  token exchange is hand-rolled in StoryShelf.
- **StoryShelf owns users, memberships, invites and UI.** Engine identities mirror into the shelf
  `users` table through Better Auth database hooks; that table is the source of truth for roles.
  All logins go through engine endpoints mounted at `/api/auth/*`.
- **Storage bridge:** an opaque `DBAdapter` bridge in `@storyshelf/auth` maps the engine's models
  onto shelf tables with no dialect knowledge (SQLite, Turso, Postgres). Core gains one optional
  method, `DatabaseAdapter.transact?`. The engine tables (`user`, `session`, `account`,
  `verification`, `passkey`, `ssoProvider`) migrate on boot with `IF NOT EXISTS`.
- **No auth configured** means development mode: every request is anonymous and every operation is
  permitted. This is for local development and networks protected by other means.

```ts
import { createShelfAuth, ensurePasswordAdmin } from "@storyshelf/auth";

const shelf = createShelfAuth({
  db: database,
  secret: process.env.SECRET!,
  baseURL: process.env.PUBLIC_BASE_URL!,
  passkeys: {},
  sso: { providers: [/* ssoKeycloakPreset(...), samlPreset(...) */] },
});
await ensurePasswordAdmin(database, {
  email: process.env.AUTH_EMAIL ?? "admin@example.com",
  password: process.env.AUTH_PASSWORD!, // at least 12 characters
});
const app = createShelfApp({ database, storage, auth: shelf.adapter });
```

### 2. Login methods are descriptors on one login page

Methods are `password`, `oauth`, `passkey` and `sso`; several can be enabled at once (local
accounts, several social or OIDC providers, domain-routed enterprise SSO). They drive one login
page whose structure is fixed; `ui.auth` overrides its text (title, subtitle, password labels,
submit label, a `{label}` template for provider buttons, help and footer). There is no render hook:
the login page is security-sensitive chrome.

Boot-time guards: method ids must be unique, and custom engine plugins must not shadow
shelf-reserved engine paths. Runtime SSO provider management is blocked (`disabledPaths`);
providers are code-driven recipes (`ssoKeycloakPreset`, `samlPreset`, `cognitoPreset`,
`keycloakPreset`, …). At sign-in, code (`defaultSSO`, recipes) takes precedence over database rows,
which take precedence over plugin defaults.

Passkeys need a secure context (`localhost` or HTTPS); the UI hides passkey affordances otherwise.

### 3. Configuration is validated code with secret references

Auth options are validated zod schemas. Secrets are written as `{env:NAME}` references, resolved
from `process.env` first and then from a customer-owned `resolveSecrets` hook (Vault, AWS, GCP).
Precedence is explicit value, then reference, then default (`resolveAuthOptions`). `SECRET` is
required whenever auth is enabled.

### 4. Local accounts are invite-only

Teams without an IdP get per-user email and password accounts. An admin invites any syntactically
valid email; deliverability is never checked, so internal or fictional addresses work. The invite is
a one-time link (`/auth/invites/:id`, 7-day expiry, hashed at rest, superseded when re-issued); the
invitee sets their own password, and accepting signs them in and lands on `/profile`. No temporary
passwords exist anywhere, and recovery is a re-invite. Login errors are generic to avoid user
enumeration. Local emails are identifiers, not mailboxes: no verification, no SMTP, no self-service
email reset.

A first admin is provisioned from the environment by `ensurePasswordAdmin` (`AUTH_EMAIL`, default
`admin@example.com`; `AUTH_PASSWORD`, at least 12 characters). There is no shared-password login
tier.

### 5. Sessions live in the engine

The session cookie is `storyshelf_session`, with a 7-day TTL and no cookie cache, so revocation and
disabled-user checks take effect immediately. Sessions are stored in the engine's tables, so a user
can see and revoke their sessions and devices from `/profile`.

### 6. Every signed-in person has a profile

`/profile` shows avatar, editable display name, email, site role, provider, groups, memberships and
sessions, plus passkey registration and password change for local accounts. A user-edited name is
kept in `users.display_name_override` and survives IdP refreshes.

### 7. Relying-party discovery

StoryShelf is a relying party, not an IdP. `/.well-known/openid-configuration` returns RP helper
metadata (issuer, `code` flow, scopes, per-provider redirect URIs, provider list) so operators can
register StoryShelf with their IdP by copy and paste. `/.well-known/change-password` redirects to
`/profile`. Both are exempt from the auth gate. The issuer comes from the public-origin resolver of
ADR 0007 (Remote Browsers and Public Origin), falling back to the request origin.

### 8. Authentication from the IdP, authorization in StoryShelf

Any person the IdP admits can sign in. What they may do, and on which project, lives in StoryShelf.

**Site roles** are `admin` and `member`. A site admin creates and deletes projects, manages server
settings and has `admin` on every project.

**Project roles** are assigned per project in `project_members`, ordered by capability:

| Action                                             | admin | approver | developer | viewer | anonymous     |
| -------------------------------------------------- | ----- | -------- | --------- | ------ | ------------- |
| View builds, library, components, diffs            | yes   | yes      | yes       | yes    | public builds |
| View the published Storybook                       | yes   | yes      | yes       | yes    | public builds |
| Re-run or retry builds                             | yes   | yes      | yes       | no     | no            |
| Comment on builds, stories and snapshots           | yes   | yes      | yes       | no     | no            |
| Approve or reject snapshots and builds             | yes   | yes      | no        | no     | no            |
| Manage members, tokens, webhooks, project settings | yes   | no       | no        | no     | no            |

```ts
function effectiveRole(user, project): "admin" | "approver" | "developer" | "viewer" | null {
  if (user.role === "admin") return "admin"; // site admin sees every project
  return projectMembers.find((m) => m.userId === user.id)?.role ?? null; // null = no access
}
```

- A non-admin needs a `project_members` row to see a project at all.
- **Approvers are the reviewers.** `approver` and `admin` approve or reject snapshots and give the
  build-level verdict; there is no separate reviewer role (ADR 0013, UI Review). The split from
  `developer` exists for the merge gate (ADR 0014, Git Hosts and Notifications): developers push and
  re-run, and only approvers can green-light a merge.
- **Comments** are written by `developer`, `approver` and `admin`; `viewer` reads. The rule is the
  same for build, story and snapshot comments.
- **Anonymous access** is limited to public builds (ADR 0010, Projects, Published Storybook and
  Labels): a build marked public or on a branch matching the project's public-branch pattern.
- **Access is the same in every mode.** Hosting-only (ADR 0006, Testing Option, Hosting-Only Mode
  and the Database Queue) does not open anything up: route classes gate features, never access, and
  the project review switch never widens who can view a project.

### 9. IdP group sync per SSO recipe

An SSO recipe can name a groups claim or attribute (`groupsClaim` / `groupsAttribute`, default
claim `groups`) and `adminGroups`. On every SSO sign-in, a match on `adminGroups` makes the user a
site `admin`, and no match reconciles them to `member`. Project memberships follow the group
mappings on each project's Members tab: exact group names, highest-ranked role wins, recorded as
`sso:<group>`; stale group grants are revoked and manual grants are never touched. Social and
generic OAuth logins have no per-login hook and never sync groups. Users first seen through OAuth
are linked by email and keep their existing shelf row and roles.

### 10. CLI and API tokens are separate from sessions

The CLI sends `Authorization: Bearer shelf_TOK_…`. The server hashes the token, looks it up in the
`tokens` table and resolves its project; no user identity is involved. Token auth runs before
session auth: when an `Authorization` header is present the session check is skipped. Project
admins manage their project's tokens.

### 11. User OAuth connections ("Connect your account")

- **Service-neutral contract.** `@storyshelf/core/adapter/oauth` defines `OAuthClient`
  (`authorizeUrl`, `exchangeCode`, `refresh`) and `OAuthConnectable` (an adapter with
  `metadata.{kind,name}` and an optional `oauth`). The adapter holds its operator-registered client
  id and secret (`createFigmaDesign({ oauth })`, `figmaOAuthFromEnv()`); without `oauth` the service
  is not connectable and no prompt appears.
- **One shared flow.** `GET /connections/:service/start`, `GET /connections/:service/callback` and
  `POST /connections/:service/disconnect` serve every connectable service, listed by
  `connectableServices()` (`app/src/connections.ts`). The flow needs auth enabled (a user owns the
  connection) and `config.secret`.
- **Signed, browser-bound state.** `state` is an HMAC-signed, 10-minute payload (`userId`,
  `service`, `returnTo`, nonce), and the nonce is also an `HttpOnly` cookie. The callback requires a
  valid signature, the same service, the same signed-in user and the matching cookie; the return path
  must be a same-site path.
- **Per-user storage.** `user_connections(user_id, service, token_encrypted,
refresh_token_encrypted, expires_at, status)`, unique on `(user_id, service)`. Tokens are encrypted
  with the credential keys and included in secret rotation. `ConnectionModel.accessToken` refreshes
  lazily, once per connection per process, when the token is within a minute of expiry; a failed
  refresh sets `status = expired` until the user reconnects.
- **Used only on the owner's visit.** Background work never uses a member's token; a page view by
  that member fetches with it.
- **Project credentials win.** A member's connection is used only when the project has no credential
  of its own, and only for that member. Entries fetched that way are stored per viewer and served
  only to that user, render route included, so a private file's preview never reaches someone
  without access (ADR 0018, Design Providers).

## Consequences

**Positive:**

- Enterprise teams plug in their existing IdP over OIDC or SAML, social logins and passkeys sit
  beside them, and teams without an IdP get real accounts with no email infrastructure.
- Protocol security rests on a maintained engine, not per-method code in StoryShelf.
- Roles stay in StoryShelf, so the IdP does not need groups for every team and role combination;
  group sync is available where an SSO IdP has them.
- Server-side sessions are revocable per device, and disabled users lose access at once.
- New connectable services (Jira, Linear) need only an `oauth` client on their adapter and a line in
  `connectableServices()`.

**Negative:**

- Better Auth is a framework dependency with its own tables, owned by `@storyshelf/auth`.
- There is no shared-password tier for very small teams; they invite users or bootstrap one admin.
- Invite links are bearer credentials until used (single use and a 7-day expiry mitigate this).
- SSO providers cannot be added at runtime; changing them is a code and deploy change.
- Some third-party services issue one access token per app per user, so a refresh invalidates the
  previous token. The in-process lock prevents concurrent refreshes in one process but not across
  several app instances; the rare race ends in `expired` and a reconnect.

## Alternatives rejected

- **A hand-rolled auth adapter per method (password, OIDC) composed behind a multi-auth wrapper.**
  Small at first, but every method re-implemented sessions, cookies, CSRF state and revocation, and
  SAML and WebAuthn would have meant hand-rolled security protocols.
- **A shared-password login.** No per-user identity, so no roles, comments or approvals that can be
  attributed to a person.
- **Project roles mapped from IdP claims only.** Forces the IdP to maintain StoryShelf-specific
  groups; group mappings are an optional addition to in-app membership instead.
- **A custom render hook for the login page.** The page is security-sensitive and a hook would fork
  its maintenance; text overrides and brand config cover rebranding.
- **Connection flows specific to each service.** Storage, refresh, state signing and routes would be
  rebuilt for every adapter.
- **An admin switch to forbid member connections.** Not needed: a project credential takes
  precedence.
