---
title: Remote browsers
description: Render captures in browsers on other machines, a self-hosted Playwright server or a hosted service, and what that changes for baselines, fingerprints and concurrency.
---

A server that launches every browser itself pays for every browser, and can only render the engines it can install. A **remote target** moves the browser elsewhere: the runner connects to a browser over a WebSocket instead of launching one, and everything else (the capture pipeline, diffs, baselines, review) is unchanged. The decisions are in ADR 0007.

With only remote targets in `browsers`, the host needs no installed browsers at all (`playwright-core` or `puppeteer-core` only). It is not idle: diffing, parameter extraction, unzipping and, for some targets, serving the Storybook over the connection still run on it, and every screenshot comes back over the WebSocket.

## Targets and baselines

A remote target is named `<engine>@<name>`, for example `chromium@grid`. The name comes from the service's `name` option or its fixed default (`grid`, `azure`, `browserstack`), never from anything that changes (an OS, a browser version, an endpoint).

- A remote target has **its own baselines**. It is never compared with a local render of the same engine: different hosts, fonts and GPU paths would turn every comparison into noise or into false environment migrations. Moving a project from local to remote is a "new engine" bootstrap, like enabling Firefox.
- The name is stored in every snapshot and baseline key, so renaming a target starts fresh baselines for it. A name is lowercase letters, digits and hyphens, starts with a letter or digit, and is at most 32 characters. Two entries of one service (Windows and macOS on one provider) need an explicit `name` on at least one; a clash fails when the runner is created, naming both entries.
- Projects choose targets in **Settings → Capture** like engines. Saving a target the runner does not offer, or that is unavailable, is refused with the reason. Remote capture is opt-in per project: the Storybook, possibly unreleased UI, is rendered by whoever runs the browser.

## Declaring them

Remote services are entries of the runner's `browsers` list, imported from the `/remote` subpath of the runner package. Each is plain configuration; no vendor SDK is needed.

```ts
import { createPlaywrightCaptureRunner, local } from "@storyshelf/runner-playwright";
import { azurePlaywright, playwrightServer } from "@storyshelf/runner-playwright/remote";

const runner = createPlaywrightCaptureRunner({
  browsers: [
    "chromium", // local; the first target is the default for new projects
    playwrightServer({
      name: "grid",
      endpoint: "ws://playwright:3000/storyshelf",
      sessions: 8, // concurrency cap, see below
    }), // → chromium@grid, firefox@grid, webkit@grid
    azurePlaywright({
      endpoint: process.env.PLAYWRIGHT_SERVICE_URL!,
      token: process.env.PLAYWRIGHT_SERVICE_ACCESS_TOKEN!,
      sessions: 20,
    }), // → chromium@azure, firefox@azure, webkit@azure
  ],
});

createShelfApp({ database, storage, testing: { runner } });
```

Credentials are operator-level: they are passed in the server's code, from the environment or a secret manager. They are never stored per project, and never logged: the endpoint (it can carry a key) and every header value are removed from the messages the runner surfaces.

| Preset                     | Package                                | Protocol   | Reaches the Storybook through |
| -------------------------- | -------------------------------------- | ---------- | ----------------------------- |
| `playwrightServer(...)`    | `@storyshelf/runner-playwright/remote` | Playwright | `exposeNetwork` (default)     |
| `azurePlaywright(...)`     | `@storyshelf/runner-playwright/remote` | Playwright | `exposeNetwork`               |
| `browserstack(...)`        | `@storyshelf/runner-playwright/remote` | Playwright | a Storybook URL               |
| `remote({ protocol, reach, connect, ... })` | `@storyshelf/runner-playwright/remote` | either     | as the connection says        |
| `cdp(...)`                 | `@storyshelf/runner-puppeteer/remote`  | CDP        | a Storybook URL               |

`remote()` is the generic constructor every preset is sugar over, so a provider without a preset needs no new release. A fixed service declares how it is reached and where:

```ts
remote({
  name: "mygrid",
  engines: ["chromium", "firefox", "webkit"],
  protocol: "playwright", // or "cdp" (Chromium only)
  reach: "loopback", // "url" when the service cannot route back to the host
  connect: { endpoint: "wss://…", headers: { authorization: "Bearer …" } },
  sessions: 4,
  platform: "linux", // reported in the fingerprint when the page cannot tell
});
```

`protocol` and `reach` are declared, never inferred: `reach: "loopback"` makes the runner connect with Playwright's `exposeNetwork: "<loopback>"` (the only pattern supported), and `"url"` means the browser needs a signed Storybook URL. A service that must be woken or started first gives `connect` as a function instead (see [Scale to zero](#scale-to-zero-connect-release-and-refcounted)).

Presets validate when the runner is created, not when the first build runs: a bad name, an empty `engines`, an engine the protocol cannot serve (`firefox` over CDP, or on a Chromium-only runner), `reach: "loopback"` with CDP, a fixed endpoint that is not a WebSocket URL, an unknown option, or two entries with one target all throw. `engines` picks a subset of what a service offers.

The presets other than `playwrightServer` follow each vendor's published connection format and have been checked against a mock, not against a live account (BrowserStack and Azure accounts are not available to this project's tests); report differences you meet.

## How the browser reaches the Storybook

The Storybook is extracted on the host and served on `127.0.0.1`, which a remote browser cannot open on its own. There are two ways in (ADR 0007, decision 5):

- **`exposeNetwork`** (Playwright's own protocol, on a self-hosted Playwright server and Azure Playwright Workspaces): the runner connects with `exposeNetwork: "<loopback>"`, and the remote browser's requests for `127.0.0.1` are routed back through the connection to the host, so the static server works unchanged and nothing new is exposed. Every asset crosses the WebSocket, so a remote render is slower per page than a local one.
- **A Storybook URL** (CDP-only services, every Puppeteer remote target, and providers that cannot route back such as BrowserStack): the runner is given an absolute, signed URL to the build's published Storybook and navigates there. This needs a `secret` and a confirmed [public origin](/guides/config/#public-origin) (a detected, unconfirmed address does not count). Until both exist such a target is `unavailable` on **System → Capture browsers** with the reason ("no secret: set the server secret, it signs the Storybook URL the remote browser opens" or "no public origin: set PUBLIC_BASE_URL, or confirm the detected origin on the System page"), settings saves naming it are refused, and a build that still reaches one (a project saved before the origin went away) fails at once with that reason before anything renders: no story runs on the other targets first, and no partial result is stored. Fix the reason and retry the build.

### Signed Storybook URLs

For a `reach: "url"` target the job mints a URL of the form `<public origin>/_s/<token>/` for each render pass and for the parameter pre-pass; the URL is always the build's directory root, ending in a slash, with no `iframe.html`, query or fragment; the runner opens `<url>iframe.html` and the assets beside it, and refuses any other form before it connects. `GET /_s/<token>/<file>` serves static files of that one build and nothing else: no session is needed, the token is the only credential.

- **What a token grants.** Read access to the files of one build of one project (`<projectId>:<buildId>:<expiry>`, signed with HMAC-SHA-256). Not the wrapper page, not a directory listing, not the API, not another build, not another route. A token for a build whose project does not match, or a build that was deleted, answers `404`.
- **Key.** Derived from the server `secret` with a fixed context, so a token cannot be mistaken for a session or any other signature. During a rotation a token signed with `previousSecret` is also accepted; once `previousSecret` is removed, outstanding tokens stop working.
- **Lifetime.** Derived from the render: the pass's render budget (15 minutes, or 15 seconds per capture for a big matrix of stories, viewports and engines) plus 5 minutes, at least 2 hours and at most 24 hours. A project can set its own lifetime instead, in whole seconds from 1050 to 86400, under **Settings → Capture** (project admins) or as `storybookUrlTtlSeconds` on `PATCH /api/v1/projects/:slug`; clear it to return to the derived value. The floor is one minimum slice (50 captures at 15 seconds each) plus the 5 minute grace, so a render slice can never outlive its token; a shorter value is refused (`400`) with the floor in the message. A fresh token is minted whenever a render pass starts (a retried pass, a crash-isolation pass and a shard that waited in the queue each get their own), so the lifetime only has to outlast one pass. A pass whose budget would outlast the lifetime (about 5700 captures at the 24 hour ceiling, fewer with a project override; a slice is never smaller than 50 captures) is rendered in slices of stories, each with a freshly minted URL, so a huge build never dies when its token does; the cost is one browser start per slice. A token that claims more than 24 hours is refused even when it is correctly signed.
- **Rate limit.** Each client IP may make 6000 requests a minute to the route (a render fetches thousands of assets from one farm address). `testing.storybookUrlRateLimit` changes it. Over the limit the route answers `429` with `Retry-After` before it looks at the token, so the answer says nothing about whether a token is valid; raise the limit when a large farm shares one outbound address.
- **Every refusal looks the same.** A malformed, tampered, expired or unknown token, a path outside the build and a missing file all answer an identical `404`; the reason is only in the server's debug log.
- **Responses** carry `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow` and `X-Content-Type-Options: nosniff`. A served file also answers `Access-Control-Allow-Origin: *` (never with credentials), so a sandboxed frame without cookies can load the module scripts of a Storybook through a signed URL; a refusal carries no CORS header.
- **One reader.** The route serves files through the same handler and the same access rule as the published Storybook routes (a signed token, or a build anyone may open, or a signed-in viewer), so paths, the manifest and content types behave identically. `/_s/` is not the `/_/` short link.
- **Without `testing`** the route answers `404` as if it did not exist; a hosting-only instance never mints or serves one.
- **The token is kept out of logs.** The request log, the OpenTelemetry `url.full` attribute, attempt logs, failure text and error serializers replace `/_s/<token>` with `/_s/[redacted]`.

**What the provider sees.** The remote service receives the URL, and a hosted service may record it (BrowserStack stores the URLs a session visits, for example). The token is the only secret in it and it expires, so keep the lifetime short, and treat a provider's session logs as holding a read link to that build for that long. Use a self-hosted farm with `exposeNetwork` when a Storybook must not leave your network at all.

## What is measured in the browser

The capture fingerprint (see [Capture](/concepts/capture/)) of a local render comes from the host: its platform and its `fc-list` fonts. For a remote render both describe the wrong machine, and a fingerprint that cannot see the remote would let a provider-side image change through without a diff, and on the default branch rewrite the baselines as a migration. So a remote render reports its environment from the browser it drove:

- `browserVersion`: what the connection reports.
- `platform`: the OS the page reports (`navigator.userAgentData`, else `navigator.platform`), normalised (`linux`, `windows`, `macos`), falling back to the service's configured `platform`. Never `process.platform`.
- `deviceScaleFactor`: `window.devicePixelRatio` of the page.
- `fontsHash`: a digest over a fixed list of 44 common font families, each tested in a blank page by measuring text against the generic family it would fall back to. `fc-list` is not used. Changing that list would re-baseline every remote target, so it is part of the fingerprint's contract.

A field the runner cannot determine (a page that would not open) is omitted, and an unknown fingerprint component is not read as a change. Provider browser builds move: pin the browser version in the preset where it has one (`browserVersion` on BrowserStack), because every move is a baseline migration on the default branch.

## Sessions and failures

- `sessions` is the plan's parallel-session limit. For a remote target the runner renders at most that many pages at once, instead of sizing pages from this host's CPU and memory. The cap is **per target and per process**: concurrent shards of one target share one limiter, so they do not multiply it. An explicit `concurrency` can lower a render's share, never raise it. It defaults to 1; set it to what you pay for.
- `sessions` is per app instance. When several instances share one provider plan, divide the limit among them. For a self-hosted farm put the cap on the farm (below). A shared limit across instances is not built.
- Connection-level failures (a refused or dropped connection, a timeout, "no capacity", 429 and 5xx answers) are retried with exponential backoff (500 ms, doubling, three retries by default; `retry: { attempts, backoffMs }` and `timeouts: { connectMs }` on `remote()`) **before** the render sees them, so a provider outage is not treated as a story crash. When the retries are spent the job fails at once with the reason (a `TargetLaunchError`), not through crash isolation.
- A failure that no retry fixes (refused credentials, a missing endpoint, mismatched versions) also marks the target `unavailable` with the reason on **System → Capture browsers**, until the server restarts. A service that is merely down does not: it stays offered, and the next build tries again.
- A browser that dies while rendering is a crash like a local one and goes through crash isolation as usual.
- Browser recycling (`recycleBrowserEvery`) opens a new remote session instead of relaunching.

## Self-hosted farm

The official Playwright image running `playwright run-server`, **pinned to exactly the `playwright-core` version of the runner**:

```sh
docker run --rm --init -p 3000:3000 --ipc=host --user pwuser --workdir /home/pwuser \
  mcr.microsoft.com/playwright:v1.63.0-noble \
  npx -y playwright@1.63.0 run-server --port 3000 --host 0.0.0.0 --path /storyshelf-4f1c --max-clients 8
```

then `playwrightServer({ endpoint: "ws://<host>:3000/storyshelf-4f1c", sessions: 8 })`. Both the image tag and the `playwright@` version must equal the runner's `playwright-core` (`1.63.0`); a test in the runner package fails when this page drifts from it.

Playwright connect needs the client and the server on the same minor version. When they differ the server refuses the handshake, and the runner reports, with the endpoint removed: `Playwright version mismatch: the server runs v1.40 but this runner's playwright-core is 1.63.0; run the server at exactly 1.63.0`. The target is marked unavailable; upgrade whichever side is behind.

What a bare `run-server` does, measured against the pinned version:

- **No authentication.** Anyone who can reach the port and knows `--path` can start browsers. A wrong path is refused at the handshake (`400`), so a long random `--path` is the only gate it has. Keep the port off the internet: put it on a private network, or behind a reverse proxy that checks a token (`playwrightServer({ token })` sends `authorization: Bearer …`) and terminates TLS (`wss://`).
- **A client cap that queues.** `--max-clients` bounds concurrent connections, but a connection over the cap is not refused: it waits until a slot frees, which the runner sees as a connect timeout (30 s by default, then retried). Set `--max-clients` to at least the number of renders that can run at once (one connection per render, so `testing.concurrency` times the shards in flight), and raise `connectTimeoutMs` if renders outnumber it. `sessions` still bounds the pages each target renders.
- **Browsers on the server.** The image carries Chromium, Firefox and WebKit. Size it for the pages you allow: roughly 100 to 300 MB each.

For several pools, declare one `playwrightServer` per pool with its own `name` and endpoint (`firefox@pool-b`, `chromium@pool-a`): each target maps to its endpoint, so no job routing is needed.

## Scale to zero: `connect`, `release` and `refCounted`

A fixed `connect` object cannot start, wake or pick something before a connection. Give `connect` as a function (sync or async) and, optionally, a `release`:

```ts
remote<{ id: string }>({
  name: "pool",
  engines: ["chromium"],
  protocol: "playwright",
  reach: "loopback",
  sessions: 4,
  timeouts: { acquireMs: 20_000 },
  // Before each connection: wake a server, pick one per shard, mint a token.
  connect: async ({ engine, buildId, runId, shardIndex, purpose, attempt, signal }) => {
    const server = await pool.wake(shardIndex ?? 0, signal); // your provider's client
    return {
      endpoint: server.endpoint,
      headers: { authorization: `Bearer ${server.token}` },
      lease: { id: server.id }, // handed back to release, never logged
    };
  },
  // Once, after the render that used the connection finished, failed or was cancelled.
  release: async (lease, { outcome, error }) => {
    await pool.suspend(lease.id); // outcome: "finished" | "failed" | "cancelled"
  },
});
```

**The context `connect` receives**

| Field        | Meaning                                                                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `engine`     | The engine being connected.                                                                                                              |
| `buildId`    | The StoryShelf build; the same for every shard.                                                                                          |
| `runId`      | The shard's id; the build id when the render is not sharded.                                                                             |
| `shardIndex` | The shard's **1-based** position in the plan, and **`undefined` (never `0`) when the build is not sharded**. Stable if a shard is retried. |
| `purpose`    | `render` (a build or shard), `extract` (the parameter pre-pass) or `tests` (`.test()` entries). The pre-passes connect too.               |
| `attempt`    | This connection's attempt, from 1; every retry connects anew.                                                                            |
| `signal`     | Aborts while `connect` is pending: on `timeouts.acquireMs`, a cancel (user, build, render budget) and shutdown. Spent once `connect` resolves. |

**Lifecycle**

- `connect` runs once per connection: a render, a shard, a browser recycle, and each pre-pass. Calls can overlap, so shards of one build can each get their own server.
- `release` runs exactly once for every connection that returned a `lease`: when the render ends (`finished`), fails (`failed`, with the error), or is cancelled (`cancelled`); when the handshake fails after `connect` returned (`failed`, before the retry connects again); and for leases still held at shutdown (`cancelled`). **It is skipped when `connect` returns no lease**, and a warning says so once per target if `release` is set. `release` is awaited with its own `timeouts.releaseMs` (default 30 s); a throw or a timeout is logged (the error's class only, never its message or the lease) and never fails the render.
- If `connect` itself throws after starting something, there is no lease to release: attach one to the error (`new RemoteConnectError(message, { lease })`) and it is released as `failed`.
- `timeouts.acquireMs` bounds the `connect` function; `timeouts.connectMs` starts when it resolves and bounds the handshake. A lease that arrives after `acquireMs` is released at once.
- The connection `connect` returns must be `endpoint`, `headers` and `lease` only: `protocol` and `reach` are declared on `remote()`, and a wrong scheme or an extra field fails the job.
- `sessions` can be a function, read each time a render pass starts and a page waits for a slot, for a provider whose cap follows the servers it has woken. A value that is not a finite number keeps the last good one (and logs once); below 1 counts as 1.

**Errors**

- A throw in `connect` is retried like a failed handshake (`retry`) and then fails the job with a `TargetLaunchError` reading `acquire failed: <message>`; the target stays offered.
- Throw `RemoteConnectError(message, { transient: false })` (or any error with `transient: false`) for one that no retry fixes, such as expired credentials: it also marks the target unavailable until restart. Add `scope: "job"` to fail only this job and keep the target offered, for example when a per-shard server is gone.
- The endpoint, headers and every value inside the `lease` are scrubbed from error text and never logged, stored or put on a span. Keep credentials in the endpoint, headers or lease, not in the messages you throw.

**Sharing one server: `refCounted`**

When all shards of a build use one resource (a computer woken once, suspended after), `refCounted` from `@storyshelf/runner-playwright/remote` counts the connections for you:

```ts
const computer = refCounted({
  open: async (context, signal) => ({ host: await wake(signal) }), // first connection; idempotent
  close: async (resource) => await suspend(resource.host),
  idleMs: 120_000,
});

remote({
  /* name, engines, protocol, reach, sessions … */
  connect: computer.connect((resource) => ({ endpoint: `wss://${resource.host}/run` })),
  release: computer.release,
});
```

- `open` is shared by concurrent first connections and must be **idempotent** (check state, wake only if not ready): it runs again after a failed `close` and can overlap a `close` that timed out. Its `signal` aborts when every waiting connection was cancelled, and at shutdown; clean up when it does, or throw an error with a `resource` property so the pool closes it.
- `close` runs `idleMs` after the last release (required: set it longer than the gap between a build's passes, the pre-passes and shards connect close together). A connection arriving while it closes waits, then opens again.
- A `close` that throws or exceeds `closeTimeoutMs` (default 30 s) leaves the resource `unknown`: the next connection calls `open` again and the idle timer retries the close. The error's class is logged, never its message.
- **Shutdown.** `lifecycle.teardown()` (what the app runs on SIGTERM) aborts pending `connect` signals, releases every held lease as `cancelled`, then closes every pool at once, ignoring `idleMs`. There is no `close()` on the runner. Pools register themselves in a process-wide registry, so two apps in one process would close each other's pools, and tests must call `pool.dispose()`.

**On the Puppeteer runner.** `cdp()` takes the same lifecycle: pass `connect` as a function (with `release`, `retry`, `timeouts`) instead of `endpoint`, and import `RemoteConnectError` and `refCounted` from `@storyshelf/runner-puppeteer/remote`. The context, release outcomes, error handling and shutdown behave as above (`purpose` is `render` or `tests`; Puppeteer has no parameter pre-pass). What differs is the protocol: CDP drives Chromium only, so `reach` is always `url` and every render needs a signed Storybook URL (a confirmed public origin and a server secret). The server must speak CDP (Chrome or Chromium with remote debugging), not Playwright's `run-server`. Puppeteer's `connect` cannot be aborted mid-handshake, so `signal` only stops a `connect` that is still pending; an open handshake runs to `timeouts.connectMs`.

```ts
import { cdp, refCounted } from "@storyshelf/runner-puppeteer/remote";

const chrome = refCounted({ open: wakeChrome, close: suspendChrome, idleMs: 120_000 });
cdp({
  name: "pool",
  sessions: 4,
  connect: chrome.connect((resource) => ({ endpoint: `wss://${resource.host}/devtools/browser` })),
  release: chrome.release,
});
```

## Upgrading from 0.7

0.8 is a breaking release for `remote()`; a 0.7 call fails at runner creation with a message naming the replacement. The presets (`playwrightServer`, `azurePlaywright`, `browserstack`, `cdp`) keep their options.

| 0.7                                                      | 0.8                                                                                |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `connect: (engine) => ({ protocol, endpoint, … })`       | `protocol` and `reach` on `remote()`; `connect: { endpoint, headers }`, or a function receiving a context object |
| `exposeNetwork: "<loopback>"` on the connection          | `reach: "loopback"` (`"url"` for none)                                             |
| `connectRetries`, `connectBackoffMs`                     | `retry: { attempts, backoffMs }`                                                   |
| `connectTimeoutMs`                                       | `timeouts: { connectMs }`                                                          |
| `acquire` (0.7.1 only)                                   | merged into `connect`                                                              |

## Other services

- **Browserless** and other CDP services: `cdp({ name, endpoint, headers, sessions })` on the Puppeteer runner, or `remote({ protocol: "cdp", reach: "url", connect: { endpoint } })` on the Playwright runner (Chromium only, and noticeably lower fidelity than Playwright's own protocol, which is acceptable because the target is its own engine with its own baselines). Both need a Storybook URL.
- **Azure Playwright Workspaces**: `azurePlaywright({ endpoint, token, os, sessions })`, with the workspace's browser endpoint (`PLAYWRIGHT_SERVICE_URL`) and access token; it passes `os` and the API version as query parameters.
- **BrowserStack**: `browserstack({ username, accessKey, os, browserVersion, engines, sessions })`; the credentials travel in the connection's capabilities and are scrubbed from messages. Needs a Storybook URL.
- Real devices and real Safari go through WebDriver and Appium, not a connect endpoint, and are not covered.
