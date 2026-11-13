# ADR 0048: Installable App, Offline Storybooks and Web Push

## Status

Accepted (owner, 2026-11-09 and 2026-11-10; proposed by the architect). The work lands on an epic
branch. It adds one service worker to an app that otherwise has no client-side state, so the limits
below are part of the decision, not implementation detail.

## Context

The owner wants three things:

1. **An installable app.** Reviewers can install StoryShelf as its own window with its own icon.
2. **The latest default-branch Storybook of a project, available offline.** An offline home page
   lists one Storybook link per project.
3. **Web push notifications**, alongside email, chat and git.

Today the app has no web manifest and no service worker. Pages are server-rendered with HTMX behind
a session and CSRF tokens. Published Storybooks are served from the app's own origin under
`/projects/:slug/storybook/...` (class `hosting`) through `publishedAccess` and
`servePublishedFile`.

A published build has a manifest of its files with content hashes, and blobs are shared between
builds (`content_uses`, ADR 0039), so two builds of one project mostly reference the same files.
Personal notification subscriptions already exist, and a subscription may only deliver over a
notifier kind whose `audience` is `person` (#538).

A built Storybook is often 10–100 MB, and a cached copy stays on the device after the session that
fetched it ends. Owner answers, 2026-11-10:

- **Opt-in per device.** Keeping a project offline is chosen on each device: per project, or "all
  my projects". The device has a storage cap.
- **Private projects are allowed offline.** Signing out clears everything offline on that device,
  and each online sync re-checks access.

## Decision

### 1. Installable

- `GET /manifest.webmanifest` (class `hosting`, no session needed) describes the app:
  - `name` and `short_name` "StoryShelf";
  - `start_url` `/` and `scope` `/`;
  - `display` `standalone`;
  - theme and background colours from the theme tokens;
  - icons at 192 px, 512 px and maskable 512 px.
- The document head links the manifest and sets `theme-color`. Nothing else in the app changes.

### 2. One service worker, with three jobs only

`GET /sw.js` (class `hosting`, `Cache-Control: no-cache`) serves one plain script, scope `/`. Its
source lives in `packages/app/src/shell/`, like the other client scripts. It does three things:

- serve opted-in Storybooks offline (section 3);
- show the offline home page (section 3);
- show push notifications (section 4).

Every other request passes straight to the network. The worker never caches app HTML, `/api/v1`
answers, session state or CSRF tokens. When the network is down, a navigation outside `/offline`
falls back to the offline home page. The worker never answers it with a stale app page.

The app never sends `Service-Worker-Allowed`. A published Storybook's own service worker therefore
controls only its build's path and can never take over the app.

### 3. Offline Storybooks

- **What is kept.** For each opted-in project, the device keeps the latest published build on the
  project's default branch. The choice of projects, the cap and the sync times are device state, in
  IndexedDB. The server stores nothing about them.
- **Sync.** `GET /api/v1/offline` (class `hosting`) answers, for each project the caller may see
  and asks about:
  - the project's slug and name;
  - the build id and commit;
  - the manifest entries (path, content hash, size);
  - `maxOfflineDays`.

  The access check is the same `publishedAccess` that every published-file route uses. A project
  that no longer appears in the answer is deleted from the device.

- **When it syncs.** On every app start while online, and through periodic background sync where
  the browser offers it.
- **Content-addressed storage.** Files are stored in Cache Storage under their content hash, with
  the path → hash map per project in IndexedDB. A new build downloads only the hashes the device
  lacks. Hashes no kept project refers to are deleted after a sync.
- **Storage cap.** The default is 500 MB per device, adjustable on the device's offline page. The
  app asks for persistent storage (`navigator.storage.persist()`). Adding a project that would pass
  the cap is refused with its size. Projects are never evicted silently.
- **Serving.**
  - Offline Storybooks are served at `/offline/<slug>/...`, and only from the cache. Online
    behaviour of the published routes does not change.
  - `/offline` is the offline home page. It is static and rendered by the worker from IndexedDB:
    one link per kept project, with the build's commit and the time of the last sync.
  - Responses built from the cache carry the same content-type and security headers that
    `servePublishedFile` sends. (see amendment 2026-11-11)
- **Limits on private data.**
  - `POST /auth/logout` answers with `Clear-Site-Data: "cache", "storage"`. That clears Cache
    Storage and IndexedDB and unregisters the worker. Before that, the page unsubscribes the
    device's push endpoint.
  - The worker stops serving a kept project once `maxOfflineDays` (default 30, server config) have
    passed since its last successful sync. A device that stays offline therefore cannot keep a
    revoked user's copy for ever.
- **Not offline.** App pages, review, comments, other branches, older builds and signed `/_s/` URLs.

### 4. Web push

- **Adapter.** A built-in integration in core, `integrations/push/` (ADR 0049; first planned as a
  `@storyshelf/notify-push` package): a `message` notifier with
  `audience: "person"`.
  - It implements Web Push with node's own crypto: VAPID (RFC 8292) and `aes128gcm` payload
    encryption (RFC 8291), tested against the RFCs' test vectors. It adds no new third-party
    dependency.
  - Its requests go through core's HTTP utilities. URLs are logged only as `redactUrlForLog`.
- **Keys.** The VAPID key pair and its contact `subject` are server configuration from the
  environment:
  - The private key is a secret. It must never appear in logs, errors, API output or the
    database.
  - Only the public key is exposed: `GET /api/v1/push/public-key`, class `hosting`.
  - Without keys, push is off and the UI hides it.
- **Devices.**
  - A new `push_subscriptions` table holds: `id`, `user_id`, `endpoint` (unique), `p256dh`,
    `auth`, `label`, `created_at`, `last_success_at`, `failure_count`. It goes into all three
    dialects, plus the core row type (ADR 0041 rule until its neutral tables land).
  - `POST /api/v1/me/push-subscriptions` registers this device and `DELETE …/:id` removes it. Both
    are class `hosting` and need a signed-in user.
  - When the push service answers 404 or 410, that device's row is deleted.
- **What is sent.**
  - Push is a `via` kind on the personal notification subscription, next to email. It is off until
    the user enables it on a device.
  - It follows the user's existing event preferences (review requested, mentions, change requests,
    build failed, …).
  - Delivery is one job per recipient on the `notify` queue, the same as review requests. Its retry
    limit is declared with that queue (ADR 0040).
- **Payload.** Only a title, a one-line body and a relative path built by the `UrlBuilder`. No
  tokens, no comment text beyond one line, and nothing sent without a confirmed public origin
  (`notificationOrigin`).
- **Clicking a notification.** The worker's `notificationclick` handler opens only paths on its own
  origin.

### 5. Route classes and gating

- Every new route is classified `hosting`, so offline Storybooks and push work on a hosting-only
  deployment.
- Push routes answer 404 when no VAPID keys are configured.
- Offline does not depend on `testing` and needs no new switch. The opt-in lives on the device.

## Consequences

- The app gains its first client-side state: one service worker plus device storage. Its scope is
  fixed above, and the rest of the UI stays server-rendered with no client framework.
- Reviewers can read the default-branch Storybook on a train. Private projects are bounded by
  sign-out, re-checked access and `maxOfflineDays`, not by trust in the device.
- Push adds one table, one adapter package and one server secret.
- On iOS, push needs the app installed to the home screen (iOS 16.4 and later), so the docs say so.
- Push services (Apple, Google, Mozilla) see when a message is sent and to which endpoint, but not
  its contents (RFC 8291 encryption).

## Alternatives considered

- **Cache every visible project on every device.** Rejected: it fills devices and downloads
  Storybooks nobody asked for (owner, 2026-11-10).
- **Public projects only offline.** Rejected by the owner. The private-data limits above make
  private projects safe enough.
- **Serve offline copies at the published paths.** Rejected: online and offline answers would mix
  on one URL, and a stale build could hide a newer one. `/offline/<slug>/` is unambiguous.
- **The `web-push` npm package.** Rejected: a few hundred lines of node crypto, pinned to RFC test
  vectors, avoids a new production dependency.
- **A cached app shell for offline review.** Rejected: review needs the server, and cached
  authenticated HTML leaks between users on a shared machine.

## Amendment, 2026-11-11 (hosting modes, #916)

- **Offline Storybooks require `trusted` mode** (path hosting on the app origin, ADR 0010 amendment). Only there can the worker serve a Storybook for the app origin's navigations. In the other modes `GET /api/v1/offline` and the opt-in UI say so, and nothing is cached. A sandboxed Storybook has an opaque origin that the worker does not control, and a worker per subdomain would orphan each build's cache and be cleared only on the app origin.
- **The worker never copies a sandbox header.** Its answers must not carry a sandbox header copied from published files. The claim in section 3 that cached answers carry the same security headers as `servePublishedFile` is withdrawn.
- **Trusted-mode threat.** In `trusted` mode uploaded code runs on the app origin, so it can read and poison that origin's Cache Storage and IndexedDB, including other projects' offline copies. The cache is therefore not a boundary between projects in that mode.
- **Order.** Install, web push and the offline home page do not wait for the hosting modes. The offline-Storybook slice waits for `config.storybookHosting` (#356).
