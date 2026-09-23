---
title: Auth
description: Secure your StoryShelf instance with OIDC/OAuth, a shared password, or none for trusted networks.
---

Auth is a pluggable adapter. StoryShelf ships three modes: **none** (default, for trusted networks), **shared password** (for small teams), and **OIDC/OAuth** (for enterprises with an identity provider). You pick one when you configure the server.

## None (default)

With no auth configured, the web UI is open and project roles are not enforced. This is fine for:

- Local development (`storyshelf-server serve`).
- A demo or internal deployment behind a VPN.

:::caution
Do not expose an auth-less instance directly to the public internet — anyone can review, approve, or reject builds.
:::

## Shared password

A single shared password gates the UI. Configure it with an environment variable:

```bash
AUTH_PASSWORD=your-shared-password
```

Anyone with the password can log in as a full user. Good for a small team that wants a cheap login without standing up an identity provider.

### Tiered viewer password (demo: open for viewers, not editors)

For a public demo that should be **read-only for viewers** but writable for admins, add a second password:

```bash
AUTH_PASSWORD=your-admin-password      # → site admin
AUTH_VIEWER_PASSWORD=demo              # → site viewer (read-only)
SECRET=your-hmac-secret                # signs both tiers
```

- `AUTH_PASSWORD` → `admin` (full control: upload, approve/reject, members, settings)
- `AUTH_VIEWER_PASSWORD` → `viewer` (read all projects without membership, cannot mutate — see [Roles & tokens](../../concepts/roles/))

When `AUTH_VIEWER_PASSWORD` is omitted, the adapter stays single-password (admin only) — existing installs keep working. The demo app at `storyshelf.fly.dev` runs in this tiered mode; publish the viewer password to demo users and keep the admin secret private. If the two passwords are set equal, admin wins.

## OIDC / OAuth

Plug into any OpenID Connect / OAuth2 provider — Keycloak, Authentik, Okta, GitHub, GitLab, Google. Configure via environment variables:

```bash
OIDC_ISSUER=https://keycloak.example.com/realms/myteam
OIDC_CLIENT_ID=storyshelf
OIDC_CLIENT_SECRET=your-client-secret
```

Users are created on first login (from the provider's identity) and assigned project roles.

### Team sync via identity-provider groups

The OIDC adapter reads group memberships from the token/userinfo response and syncs project access at each login:

- **Site roles**: `adminGroups`/`viewerGroups` (exact group name or provider ID match) grant the site `admin`/`viewer` role; everyone else signs in as `member`.
- **Project roles**: each project's Members settings tab maps IdP group names to project roles. On login the highest matched role wins (recorded as `oidc:<group>`); memberships from groups the user no longer matches are removed, while manual grants are never touched. Mapping edits apply at next login.
- **Claim names** default to `["groups", "cognito:groups"]` and are configurable via `groupClaims`. Use the matching provider preset (`keycloak`/`okta`/`entra`/`cognito`/`auth0`) from `@storyshelf/auth-oauth` — see its package page for per-provider setup (Okta claim config, Entra manifest + object IDs, Cognito default, Auth0 Actions snippet). Group names match **exactly**; wildcards are rejected because a broad pattern can silently grant org-wide access.

## Project roles

Auth enables project-scoped roles, tracked per project via membership:

| Role | Capabilities |
|------|--------------|
| `viewer` | View builds, diffs, and published Storybooks |
| `developer` | View + upload builds |
| `approver` | View + approve/reject snapshots |
| `admin` | Full control, including members and settings |

Site-wide roles are `admin`, `member`, and `viewer`. Site `admin` users (from the auth provider) bypass project roles entirely. Site `viewer` is a read-only auditor role: it can view every project without membership, but cannot mutate, manage, or administer anything; all `viewer` reads carry the user id in request logs. For a public deployment, restrict access by granting roles through project settings.

## First admin bootstrap

With auth enabled and an empty database, no one can log in as admin yet. Set `STORYSHELF_ADMIN_TOKEN` (or `ADMIN_TOKEN`) on the server: its bearer value grants site-admin API access (project creation, purge) without a session. It never mints sessions and is distinct from `SECRET` (session signing). Creating a project as a logged-in user also records them as that project's admin.

## API tokens vs. user auth

Auth gates the **web UI**. The **CLI does not use user login** — it authenticates with **per-project API tokens** sent as `Authorization: Bearer <token>` (CI, `STORYSHELF_TOKEN`) and **site-admin tokens** (`STORYSHELF_ADMIN_TOKEN`) for project creation. Tokens are bound to the user who mints them and resolve to that user's live project role, so bearer callers pass the same role requirements as sessions; demoting a user instantly downgrades their tokens. Legacy tokens minted before user binding resolve as viewer, and tokens whose owner was deleted are denied — re-issue them. Tokens are minted by [`storyshelf create`](/guides/cli/) (requires admin token, writes `.storybook/storyshelf.json`) or in project settings; client config alone can be initialized via [`storyshelf init`](/guides/cli/).

## Public Storybooks

Published Storybooks can be made viewable **without auth** when their branch matches the project's `public_branch_regex` (e.g. `^main$` or `^release-`) or when a build is explicitly marked public. Every other Storybook requires auth and at least `viewer` membership. This lets you share component previews with stakeholders who don't have accounts.
