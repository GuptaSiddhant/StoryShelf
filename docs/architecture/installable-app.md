# Installable app, offline Storybooks and web push

> Part of the [StoryShelf architecture spec](./README.md). Decisions: [ADR 0048](../adr/0048-installable-app-offline-push.md).

The app has one piece of client-side state: a service worker with device storage. Everything else stays server-rendered. Every route below is class `hosting`, so offline Storybooks and push work on a hosting-only deployment; none depends on `testing`.

## Manifest

`GET /manifest.webmanifest` (`app/src/routers/manifest.ts`, no session, `Cache-Control: no-cache`). Name and `short_name` come from the configured product name, `start_url` and `scope` are `/`, `display` is `standalone`, theme and background colours are the light theme's base surface, and the icons are 192, 512 and maskable 512. The document head links it and sets `theme-color` (`shell/document.tsx`).

## The service worker

`GET /sw.js` (`app/src/routers/service-worker.ts`, no session, `Cache-Control: no-cache`) serves the script that `shell/service-worker.ts` assembles from one fragment per concern (`service-worker-device.ts` state, `-sync.ts`, `-serve.ts`, `-home.ts`, `-push.ts`). `shell/boot-script.ts` registers it with scope `/`. The app never sends `Service-Worker-Allowed`, so a published Storybook's own worker controls only its build path.

Three jobs only: serve opted-in Storybooks offline, show the offline home page, show push notifications. Everything else passes to the network. Limits that hold for every job:

- The worker never caches app HTML, `/api/v1` answers, session state or CSRF tokens. Only `/offline` answers and the content-addressed keys (`/__offline/content/<hash>`) reach Cache Storage.
- A failed navigation outside `/offline` shows the offline home page, never a stale app page.
- `notificationclick` opens only URLs on the worker's own origin (`clickTarget`).

`POST /auth/logout` sets `Clear-Site-Data: "cache", "storage"` (`routers/auth.ts`). A browser that honours the header clears Cache Storage and IndexedDB and unregisters the worker; not every browser does, and the worker deletes nothing itself, so there the copies stay in browser storage. Only a successful sync deletes anything, and only the projects the answer omits (those the caller can no longer read); a failed sync keeps every copy, and a project the caller can still read, such as a public one after sign-out, stays. `maxOfflineDays` only stops the worker serving them; it deletes nothing. Before it, the worker unsubscribes the device's push endpoint and sends it in the `x-push-endpoint` header so the server forgets the row.

## Offline sync

`GET /api/v1/offline?projects=<slug,...>` (`routers/offline.ts`, `offline.handlers.ts`; `Cache-Control: private, no-store`; at most 100 slugs). For each slug the caller may read it answers `{ slug, name, buildId, commit, entries: [{ path, hash, size }], maxOfflineDays }`:

- The build is `BuildModel.latestApprovedDefault`, the one `/projects/:slug/storybook` opens.
- Access is `publishedAccess`, the check every published-file route uses. An unknown slug, a hidden project and a project with no published manifest are all left out, so the answer never says which exist.
- `entries` come from the build's manifest (`loadManifest`). A blob's size is measured from storage once and kept in memory by hash.
- `maxOfflineDays` is `config.offline.maxOfflineDays` (1-365, default 30; `maxOfflineDaysOf` in core).
- Outside `trusted` hosting mode (ADR 0048, amendment 2026-11-11) the answer is `{ projects: [], reason: "hosting-mode", hostingMode }`, so a device deletes what it kept.

**Device state** (IndexedDB database `storyshelf-offline`, one record; the server stores none of it): the chosen projects, the storage cap (default 500 MB), the path to hash map per project and the last successful sync time. File bytes are in Cache Storage under their content hash. A sync downloads only missing hashes, deletes projects missing from the answer and then deletes hashes no kept project uses. It runs on every app start while online and through periodic background sync where offered. The worker asks for persistent storage. A project that would pass the cap is refused with its size, and nothing is evicted silently. The page controls the worker by message (keep, unkeep, sync, usage, set-cap).

**Serving.** Kept Storybooks are answered from the cache only, at `/offline/<slug>/...`, never at the published paths. `/offline` is the home page, rendered by the worker from IndexedDB: one link per kept project with the commit and last sync time, and an expired state. A project stops being served `maxOfflineDays` after its last successful sync. The worker never copies a sandbox header from published files.

**Pages.** `pages/offline-device.tsx` (`/profile/offline`, "This device") keeps projects per project or for all, shows usage against the cap, changes the cap and syncs on demand; outside `trusted` mode it says offline Storybooks are unavailable. The Library has a "Keep offline" button.

**Threat in `trusted` mode.** Uploaded code runs on the app origin and can read or poison its Cache Storage and IndexedDB, including other projects' offline copies. The cache is not a boundary between projects there.

Not offline: app pages, review, comments, other branches, older builds and signed `/_s/` URLs.

## Web push

- **Table.** `push_subscriptions` ([`data-model-access-and-system.md`](./data-model-access-and-system.md)), in all three dialects, with `PushSubscriptionModel` in core (add or replace by endpoint, list by user, delete, record success or failure). It is deleted with its user.
- **Notifier.** `core/src/integrations/push/` (ADR 0049), exported from `@storyshelf/core/integrations`: a `push` message notifier with `audience: "person"`. Web Push on node's own crypto: VAPID (RFC 8292, `vapid.ts`) and `aes128gcm` (RFC 8291, `encrypt.ts`), with no new dependency. A 404 or 410 from the push service throws `PushGoneError`; any other failure throws an error with no key, endpoint or body. Requests go through `@storyshelf/common/http` (a raw `body` of bytes) and URLs are logged only as `redactUrlForLog`.
- **Keys.** `SHELF_VAPID_PUBLIC_KEY`, `SHELF_VAPID_PRIVATE_KEY` and `SHELF_VAPID_SUBJECT` (`vapidConfigFromEnv`, read with `readSetting`; the product image and the dev server wire it), or `ShelfOptions.notifications.vapid`. The pair is checked once at boot (`createVapid`): a garbage or mismatched pair leaves push off with one error line. The private key is held only as a `KeyObject` and never appears in logs, errors, API output or the database. Without both keys push is off and the routes answer 404.
- **Routes** (`routers/push.ts`): `GET /api/v1/push/public-key`; `POST /api/v1/me/push-subscriptions` (signed-in user; `https:` endpoint of at most 512 characters, 65-byte `p256dh` starting `0x04`, 16-byte `auth`; the same endpoint registered again replaces its row); `DELETE /api/v1/me/push-subscriptions/:id`.
- **Delivery.** `push` is a `via` kind on a personal notification subscription, off until the person registers a device and lists it. It follows the subscription's event preferences. A review request queues one `review-request` job per device on the `notify` queue (a gone device's row is deleted, other failures are retried); mentions and failures deliver inline like email.
- **Payload.** A title, a one-line body and a relative path from the `UrlBuilder`. Nothing is sent without a confirmed public origin (`notificationOrigin`).
- **Settings page.** `pages/push-devices.tsx`, a card on "This device" (`/profile/offline`), shown only with VAPID keys and a signed-in viewer. "Enable push on this device" asks for permission on the click only, subscribes with the public key and registers the device with an optional label; the list shows each device's label and last delivery, marks this browser's own (its id is kept in `localStorage`) and removes a device. The page sees only ids, labels and times, never keys or endpoints. A note says push on iPhone and iPad needs the app on the home screen. The script is `push-devices-script.ts`; the stories cover unsupported, not enabled, enabled and denied.
