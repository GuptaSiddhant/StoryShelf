---
title: Install the app and keep Storybooks offline
description: Install StoryShelf as its own window, keep the latest default-branch Storybook of chosen projects on a device, and what signing out and maxOfflineDays do to that copy.
---

StoryShelf can be installed as its own window with its own icon, and a device can keep the latest Storybook of chosen projects so reviewers can read it offline. The design and its limits are [ADR 0048](https://github.com/GuptaSiddhant/StoryShelf/blob/main/docs/adr/0048-installable-app-offline-push.md).

:::note[Status]
This page tracks epic #837. Each section says whether it has **landed** or is **planned**; a planned section is written from the ADR and its marker names the task that will make it true. Check those markers when the task merges.
:::

## Install the app

**Status: landed (#838).**

The app serves a web manifest at `/manifest.webmanifest`. It needs no sign-in, so a browser can read it from the sign-in page. It names the app (the configured product name, "StoryShelf" by default), opens at `/`, and asks for a standalone window. Its colours come from the light theme tokens, and it lists a 192 px, a 512 px and a maskable 512 px icon.

- **Chrome, Edge and other Chromium browsers:** use the install button in the address bar, or **Install StoryShelf** in the browser menu.
- **Safari on macOS and iOS:** **Share → Add to Dock** or **Add to Home Screen**.

Installing needs a secure origin (HTTPS, or `localhost`). Nothing else about the app changes: it is still server-rendered, and an installed window shows the same pages as a tab.

## What the service worker does

**Status: landed (#839); offline serving planned (#841, #842).**

The app registers one service worker, served at `/sw.js` with scope `/`. It has three jobs and no others: serve opted-in Storybooks offline, show the offline home page, and show push notifications. Today (#839) it passes every request to the network and, when a page navigation fails, shows a short "You are offline" page. The other jobs arrive with #841 (offline Storybooks), #842 (offline home page) and #845 (push).

The limits are fixed by the ADR:

- It **never caches** app pages, `/api/v1` answers, session state or CSRF tokens. Review, comments, other branches and older builds need the server, and so do signed `/_s/` Storybook links.
- It is the only worker that can control the app. The app never sends `Service-Worker-Allowed`, so a Storybook's own service worker stays confined to that build's path.

## Keep a Storybook offline

**Status: sync endpoint landed (#840). Device opt-in, storage and serving planned (#841, #842).**

Keeping a project offline is a choice made **on each device**: one project at a time, or all of your projects. The server stores nothing about it.

**What is kept.** For each chosen project, the latest published build on the project's default branch: the same build that `/projects/<slug>/storybook` opens. Nothing else is kept offline.

**How it syncs.** `GET /api/v1/offline?projects=<slug,…>` (landed) answers, for each requested project you may read, the slug, name, build id, commit, the build's file list (path, content hash, size) and `maxOfflineDays`. The answer is `Cache-Control: private, no-store`. A project that is unknown, hidden from you or has no published default-branch build is left out of the answer, and the answer does not say which of those it was. Access is checked the way every published file is checked, so each sync re-checks it.

Planned (#841): the device syncs on every app start while online, and through periodic background sync where the browser offers it. Files are stored by content hash, so a new build downloads only the files the device lacks, and files no kept project uses are removed after a sync. A project that no longer appears in the answer is deleted from the device.

**Where it is served.** Planned (#841, #842): an offline copy is served at `/offline/<slug>/…`, from the cache only, and never at the published paths, so online and offline answers never mix on one URL. `/offline` is the offline home page: one link per kept project, with the build's commit and the time of the last sync. When the network is down, a navigation outside `/offline` shows that home page rather than a stale app page.

**Storage cap.** Planned (#841, #842): 500 MB per device by default, adjustable on the device's offline page. The app asks the browser for persistent storage. Adding a project that would pass the cap is refused and shows the project's size. Kept projects are never evicted silently.

**Hosting mode.** Offline Storybooks need [`trusted` hosting](/concepts/publishing/#subdomain-hosting) (path hosting on the app origin). In the other modes the sync endpoint and the opt-in page say so and nothing is cached. This check is **planned** with the offline slice (#841): the sync endpoint at #840 does not yet refuse other modes.

## Private projects, sign-out and `maxOfflineDays`

Private projects can be kept offline. A copy on a device is bounded by three things rather than by trust in the device:

- **Sign-out clears the device.** Landed (#839): `POST /auth/logout` answers with `Clear-Site-Data: "cache", "storage"`, which clears Cache Storage and IndexedDB and unregisters the worker. Planned (#845): before that, the page unsubscribes the device's push endpoint.
- **Every online sync re-checks access.** A project you can no longer read stops appearing in the answer and is deleted from the device.
- **`maxOfflineDays`.** Landed in the answer (#840), enforced in the worker with #841: once this many days have passed since a project's last successful sync, the worker stops serving it. The default is 30. Set it in the server config:

```json
{ "offline": { "maxOfflineDays": 14 } }
```

It must be a whole number from 1 to 365. A device that stays offline therefore cannot keep a revoked user's copy for ever.

:::caution
In `trusted` hosting mode, uploaded Storybook code runs on the app's origin, so it can read and change that origin's Cache Storage and IndexedDB, including other projects' offline copies. The cache is not a boundary between projects in that mode. Use it where the people who upload Storybooks are trusted.
:::

## Related

- [Web push notifications](/guides/web-push/)
- [Server configuration](/guides/config/)
- [Published Storybook](/concepts/publishing/)
