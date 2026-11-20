---
title: Install the app and keep Storybooks offline
description: Install StoryShelf as its own window, keep the latest default-branch Storybook of chosen projects on a device, and what signing out and maxOfflineDays do to that copy.
---

StoryShelf can be installed as its own window with its own icon, and a device can keep the latest Storybook of chosen projects so reviewers can read it offline. The design and its limits are [ADR 0048](https://github.com/GuptaSiddhant/StoryShelf/blob/main/docs/adr/0048-installable-app-offline-push.md).

## Install the app

The app serves a web manifest at `/manifest.webmanifest`. It needs no sign-in, so a browser can read it from the sign-in page. It names the app (the configured product name, "StoryShelf" by default), opens at `/`, and asks for a standalone window. Its colours come from the light theme tokens, and it lists a 192 px, a 512 px and a maskable 512 px icon.

- **Chrome, Edge and other Chromium browsers:** use the install button in the address bar, or **Install StoryShelf** in the browser menu.
- **Safari on macOS and iOS:** **Share → Add to Dock** or **Add to Home Screen**.

Installing needs a secure origin (HTTPS, or `localhost`). Nothing else about the app changes: it is still server-rendered, and an installed window shows the same pages as a tab.

## What the service worker does

The app registers one service worker, served at `/sw.js` with scope `/`. It has three jobs and no others:

1. serve the Storybooks a device chose to keep, offline;
2. show the offline home page;
3. show [push notifications](/guides/web-push/).

Every other request goes straight to the network. The worker **never caches** app pages, `/api/v1` answers, session state or CSRF tokens, so review, comments, other branches, older builds and signed `/_s/` Storybook links always need the server. When a page navigation fails outside `/offline`, the worker shows the offline home page, never a stale app page.

The worker is the only one that can control the app: the app never sends `Service-Worker-Allowed`, so a published Storybook's own service worker stays confined to that build's path.

## Keep a Storybook offline

Keeping a project offline is a choice made **on each device**: one project, or all your projects. The server stores nothing about it.

- **Where to choose.** The **Keep offline** button on a project's Library page, or **This device** under your profile (`/profile/offline`), which lists the kept projects, shows storage use against the cap, changes the cap and syncs on demand.
- **What is kept.** For each chosen project, the latest published build on the project's default branch: the build `/projects/<slug>/storybook` opens. Nothing else is kept offline.
- **When it syncs.** On every app start while online, and through periodic background sync where the browser offers it. The device asks `GET /api/v1/offline?projects=<slug,…>`, which answers for each project you may read: the slug, name, build id, commit, the build's file list (path, content hash, size) and `maxOfflineDays`. Access is checked the way every published file is checked, so each sync re-checks it. A project that is unknown, hidden from you or has no published default-branch build is left out of the answer, and the answer does not say which of those it was.
- **What a sync changes.** Files are stored by content hash, so a new build downloads only the files the device lacks. A project that no longer appears in the answer is deleted from the device, and files no kept project uses are removed.
- **Where it is served.** From the cache only, at `/offline/<slug>/…`. Offline copies are never served at the published paths, so online and offline answers never mix on one URL. `/offline` is the offline home page: one link per kept project, with the build's commit and the time of the last sync.
- **Storage cap.** 500 MB per device by default, changed on the device's offline page. The app asks the browser for persistent storage. Adding a project that would pass the cap is refused and shows the project's size. Kept projects are never evicted silently.

### Hosting mode

Offline Storybooks need [`trusted` hosting](/concepts/publishing/#subdomain-hosting) (path hosting on the app origin). In any other mode `GET /api/v1/offline` answers an empty list with `reason: "hosting-mode"`, the device page says offline Storybooks are unavailable, and a device deletes what it had at its next sync.

:::caution
In `trusted` mode, uploaded Storybook code runs on the app's origin, so it can read and change that origin's Cache Storage and IndexedDB, including other projects' offline copies. The cache is not a boundary between projects in that mode. Use offline Storybooks where the people who upload Storybooks are trusted.
:::

## Private projects, sign-out and `maxOfflineDays`

Private projects can be kept offline. A copy on a device is bounded by three things rather than by trust in the device:

- **Sign-out clears the device.** `POST /auth/logout` answers with `Clear-Site-Data: "cache", "storage"`, which clears Cache Storage and IndexedDB and unregisters the worker. Before that, the worker unsubscribes the device's push endpoint.
- **Every online sync re-checks access.** A project you can no longer read stops appearing in the answer and is deleted from the device.
- **`maxOfflineDays`.** Once this many days have passed since a project's last successful sync, the worker stops serving it, and the offline home page says so. The default is 30. Set it in the server config:

```json
{ "offline": { "maxOfflineDays": 14 } }
```

It must be a whole number from 1 to 365. A device that stays offline therefore cannot keep a revoked user's copy for ever.

## Related

- [Web push notifications](/guides/web-push/)
- [Server configuration](/guides/config/)
- [Published Storybook](/concepts/publishing/)
