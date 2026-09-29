---
title: Live Demo
description: Try StoryShelf at storyshelf.fly.dev — viewer-open, seeded with fixtures.
---

The public demo at **`https://storyshelf.fly.dev`** is a full StoryShelf server (Fly `iad`, SQLite + local storage + Playwright) seeded with the `fixtures/storybook-8` project. It resets on redeploy and is intended for **viewer** triage — anyone can review diffs, only admins can mutate.

![Projects list — the demo projects](/screenshots/projects-list.png)

## Access

The demo runs env-driven local-account auth (`@storyshelf/auth`):

- **Viewer:** invite-only local accounts (see [Auth](/guides/auth/)) — browse projects, diffs, and published Storybooks; upload, approve, and settings require admin.
- **Admin:** `AUTH_PASSWORD` (private) provisions the site `admin` on boot. Keep this with maintainers only.

Open `https://storyshelf.fly.dev` → enter `demo` at the login → browse. If auth is disabled on a local fork (`AUTH_PASSWORD` unset), the UI is open without login (trusted-network mode — see [Auth](/guides/auth/)).

## What’s seeded

- Project `Demo Design System` (slug `demo-design-system`, `acme/design-system`) from `fixtures/storybook-8` — 7 stories, viewports `desktop`/`mobile`.
- A `reviewing` build (`feature/new-button`) with `changed` snapshots for the diff overlay demo — real Playwright renders (both viewports).
- The `viewer` account can open the build review (`/projects/demo-design-system/builds/:buildId`) and the published Storybook (`/projects/demo-design-system/storybook`), but **Approve/Reject** and **Settings** require admin.

![Build review — baseline, current, and diff overlay](/screenshots/build-review.png)

## Related

- [Auth (local accounts)](/guides/auth/) — invite-only login setup
- [Roles & tokens](/concepts/roles/) — member vs admin site roles
- [Projects](/concepts/projects/) — one Storybook per project
- Package: [@storyshelf/auth](/packages/auth/)
