---
title: Project settings
description: Configure members, label types, tokens, webhooks, and visibility per project.
---

Each project carries its own settings — visible under `/projects/:slug/settings` (tabs: General, Labels, Members, Tokens, Webhooks, etc.) and via `PATCH /api/v1/projects/:slug`.

## General

Name, `git_repository` (`owner/repo`), `git_default_branch` (baseline fallback, default `main`), diff thresholds (`pixel_threshold` 0–1, `max_diff_ratio` 0–1), capture browser (`chromium`/`firefox`/`webkit`/`chrome`), viewports, and `public_branch_regex` for published Storybook access (see [Published Storybook](/concepts/publishing/)).

`PATCH /api/v1/projects/:slug` is site-admin or project-admin only; `GET /api/v1/projects/:slug` respects `viewer`+ membership.

## Label types

Project-defined kinds (`pr`, `mr`, `jira`, `linear`, `figma`, `custom`) with `link_template` (`https://github.com/{repo}/pull/{value}`) and optional `color`. `persistent` and `branch` are seeded and read-only. Manage in **Settings → Labels** or via `GET/POST/PATCH/DELETE /api/v1/projects/:slug/label-types/:key`. See [Labels concept](/concepts/labels/) for linking and stable URLs.

## Members

When auth is enabled, **Settings → Members** lists `project_members` (`viewer`/`developer`/`approver`/`admin`). Project `admin` or site `admin` can `POST /api/v1/projects/:slug/members { userId, role }`, `PATCH` role, or `DELETE`. IdP group mappings (`group → role`) sync at login — see [Roles & tokens](/concepts/roles/).

## Tokens

Per-project CI tokens (`Authorization: Bearer <token>`, `STORYSHELF_TOKEN`) are minted in **Settings → Tokens** (`POST /api/v1/projects/:slug/tokens`, shown once, stored hashed) and resolve to the live role of the minting user. Revoke via `DELETE`. Site-admin tokens (`STORYSHELF_ADMIN_TOKEN`) mint projects and purge retention — see [Auth](/guides/auth/).

## Webhooks

**Settings → Webhooks** or `POST /api/v1/projects/:slug/webhooks { url, events[], secret }`. Secrets are AES-GCM encrypted with server `SECRET`; delivery is HMAC-signed. Filter by `events` or leave null for all. See the dedicated [Webhooks](/guides/webhooks/) guide.

## Related

- [Projects concept](/concepts/projects/) — one Storybook per project
- [Roles & tokens](/concepts/roles/) — site vs project roles, token binding
- [Labels](/concepts/labels/) — link templates & stable URLs
- [Auth](/guides/auth/) — OIDC / shared password
