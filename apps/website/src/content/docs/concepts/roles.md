---
title: Roles & tokens
description: Who can do what — site roles, project members, and API tokens.
---

StoryShelf has two layers of authorization: **site roles** (from the auth engine) and **project roles** (per-project members). API tokens resolve to the live role of the user who minted them.

## Site roles

`users.role` — set at invite (role param) or preserved from the existing row on SSO sign-in:

| Site role | Meaning |
|-----------|---------|
| `admin` | Site-wide bypass — sees and mutates every project |
| `member` | Default — can create/join projects via membership |

Everyone else signs in as `member`. SSO users link by email on first sign-in and keep their existing shelf roles (never demoted by login).

:::note
IdP group sync (site/project roles from group claims) is deferred — there is no `adminGroups`/`groupClaims` equivalent in the engine yet. Assign roles via invite roles or the Members settings tab.
:::

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

Each project's **Members** tab can map an IdP group name to a project role. Mappings evaluate on every SSO sign-in against the groups carried by the login identity (configure `groupsClaim`/`groupsAttribute` on the recipe). Highest matched role wins (recorded as `sso:<group>`); stale synced grants are revoked while manual grants are never touched. Social and generic-OAuth logins never sync groups.

## API tokens vs user auth

- **Web UI** — session cookie via the auth engine / none.
- **CLI/CI** — per-project **API tokens** (`Authorization: Bearer <token>`, `STORYSHELF_TOKEN`) and site-admin tokens (`STORYSHELF_ADMIN_TOKEN` / `ADMIN_TOKEN` for `storyshelf create` / `purge`). Tokens are per-project, hashed at rest, shown once at creation in Settings → Tokens.

Tokens are **bound to the minting user** and resolve to that user’s live project role — demoting a user instantly downgrades their tokens. Legacy pre-binding tokens resolve as `viewer`; tokens whose owner was deleted are denied (re-issue).

## First admin bootstrap

With auth enabled and an empty DB, no one can be `admin` yet. Set `STORYSHELF_ADMIN_TOKEN` on the server — its bearer grants site-admin API access without a session (distinct from `SECRET` which signs sessions). Creating a project as the first logged-in user also records them as that project’s `admin`.

## Related

- Guides: [Auth](/guides/auth/), [CLI — create](/guides/cli/client/) (`storyshelf create`), [CI setup](/guides/ci/)
- Packages: [auth](/packages/auth/)
- [Projects](/concepts/projects/) — tokens section
