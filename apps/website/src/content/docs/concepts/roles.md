---
title: Roles & tokens
description: Who can do what — site roles, project members, IdP group sync, and API tokens.
---

StoryShelf has two layers of authorization: **site roles** (from the auth provider) and **project roles** (per-project members). API tokens resolve to the live role of the user who minted them.

## Site roles

`users.role` — set at login via `auth-oauth` group sync:

| Site role | Meaning |
|-----------|---------|
| `admin` | Site-wide bypass — sees and mutates every project; site viewer/members also still need project membership for non-admins |
| `member` | Default — can create/join projects via membership |
| `viewer` | Read-only auditor — can read every project without membership, cannot mutate/manage/administer; all reads carry the user id in request logs |

`adminGroups` / `viewerGroups` (exact group name or provider object ID) map IdP groups to site roles. Everyone else signs in as `member`.

## Project roles

`project_members.role` — per-project, set in **Settings → Members** or synced from group mappings:

| Project role | Capabilities |
|--------------|--------------|
| `viewer` | View builds, diffs, published Storybook |
| `developer` | Viewer + upload builds |
| `approver` | Viewer + approve/reject snapshots |
| `admin` | Full control — members, label types, tokens, settings, delete |

Site `admin` bypasses all project checks. `GET /api/v1/projects/:slug/members` lists members; `POST/PATCH/DELETE` is project-admin or site-admin only.

### IdP group mappings

Each project's **Members** tab maps an IdP group name to a project role. On login:

- Claims default to `["groups", "cognito:groups"]` (configurable `groupClaims`; provider presets `keycloak`/`okta`/`entra`/`cognito`/`auth0`).
- Matching is **exact** — no wildcards (a broad pattern could silently grant org-wide access).
- Highest matched role wins, recorded as `oidc:<group>`; memberships from groups the user no longer matches are removed, manual grants are never touched. Edits apply at next login.

## API tokens vs user auth

- **Web UI** — session cookie via `auth-oauth` / `auth-password` / none.
- **CLI/CI** — per-project **API tokens** (`Authorization: Bearer <token>`, `STORYSHELF_TOKEN`) and site-admin tokens (`STORYSHELF_ADMIN_TOKEN` / `ADMIN_TOKEN` for `storyshelf create` / `purge`). Tokens are per-project, hashed at rest, shown once at creation in Settings → Tokens.

Tokens are **bound to the minting user** and resolve to that user’s live project role — demoting a user instantly downgrades their tokens. Legacy pre-binding tokens resolve as `viewer`; tokens whose owner was deleted are denied (re-issue).

## First admin bootstrap

With auth enabled and an empty DB, no one can be `admin` yet. Set `STORYSHELF_ADMIN_TOKEN` on the server — its bearer grants site-admin API access without a session (distinct from `SECRET` which signs sessions). Creating a project as the first logged-in user also records them as that project’s `admin`.

## Related

- Guides: [Auth](/guides/auth/), [CLI — create](/guides/cli/client/) (`storyshelf create`), [CI setup](/guides/ci/)
- Packages: [auth-oauth](/packages/auth-oauth/), [auth-password](/packages/auth-password/)
- [Projects](/concepts/projects/) — tokens section
