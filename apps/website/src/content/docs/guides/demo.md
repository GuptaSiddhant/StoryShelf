---
title: Live Demo
description: Try StoryShelf at storyshelf.fly.dev — viewer-open, seeded with fixtures.
---

The public demo at **`https://storyshelf.fly.dev`** is a full StoryShelf server (Fly `iad`, SQLite + local storage + Playwright) seeded with the `fixtures/storybook-8` project. It resets on redeploy and is intended for **viewer** triage — anyone can review diffs, only admins can mutate.

## Access

The demo runs tiered shared-password auth (`@storyshelf/auth-password`):

- **Viewer:** password `demo` → site `viewer` (read all projects, diffs, and published Storybooks; cannot upload, approve, or manage). Share this with stakeholders.
- **Admin:** `AUTH_PASSWORD` (private) → site `admin` (full control). Keep this with maintainers only.

Open `https://storyshelf.fly.dev` → enter `demo` at the login → browse. If auth is disabled on a local fork (`AUTH_PASSWORD` unset), the UI is open without login (trusted-network mode — see [Auth](/guides/auth/)).

## What’s seeded

- Project `storybook-fixture` (slug `storybook-fixture`) from `fixtures/storybook-8` — 7 stories, viewports `desktop`/`mobile`.
- A `reviewing` build with `changed` snapshots for the diff overlay demo.
- The `viewer` account can open the build review (`/projects/storybook-fixture/builds/:buildId`) and the published Storybook (`/projects/storybook-fixture/storybook`), but **Approve/Reject** and **Settings** require admin.

## Related

- [Auth (tiered password)](/guides/auth/) — tiered `viewerPassword` setup
- [Roles & tokens](/concepts/roles/) — viewer vs admin site roles
- [Projects](/concepts/projects/) — one Storybook per project
- Package: [@storyshelf/auth-password](/packages/auth-password/)
