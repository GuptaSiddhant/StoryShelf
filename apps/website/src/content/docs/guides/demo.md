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

## Local screenshots (no Fly dependency)

Website screenshots are taken locally from a seeded ephemeral server (same fixture) — not from Fly — so CI is deterministic and needs no demo password:

```sh
# from repo root
export PATH="$HOME/.nub/bin:$PATH"
nub run build # website prebuild + astro build
node apps/website/scripts/screenshots.mjs # chromium via playwright-core, 3 PNGs to public/screenshots/
```

Artifacts: `public/screenshots/home-hero.png`, `projects-list.png`, `build-review.png` (1280×720 @2x for hero, 1280×900 fullPage for review).

## Related

- [Auth (tiered password)](/guides/auth/) — tiered `viewerPassword` setup
- [Roles & tokens](/concepts/roles/) — viewer vs admin site roles
- [Projects](/concepts/projects/) — one Storybook per project
- Package: [@storyshelf/auth-password](/packages/auth-password/)
