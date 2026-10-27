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
| `remote({ connect, ... })` | `@storyshelf/runner-playwright/remote` | either     | as the connection says        |
| `cdp(...)`                 | `@storyshelf/runner-puppeteer/remote`  | CDP        | a Storybook URL               |

`remote()` is the generic constructor every preset is sugar over, so a provider without a preset needs no new release:

```ts
remote({
  name: "mygrid",
  engines: ["chromium", "firefox", "webkit"],
  connect: (engine) => ({
    protocol: "playwright", // or "cdp" (Chromium only)
    endpoint: "wss://…",
    headers: { authorization: "Bearer …" },
    exposeNetwork: "<loopback>", // omit when the service cannot route back to the host
  }),
  sessions: 4,
  platform: "linux", // reported in the fingerprint when the page cannot tell
});
```

Presets validate when the runner is created, not when the first build runs: a bad name, an empty `engines`, an engine the connection cannot serve (`firefox` over CDP, or on a Chromium-only runner), a non-WebSocket endpoint, or two entries with one target all throw. `engines` picks a subset of what a service offers.

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
- Connection-level failures (a refused or dropped connection, a timeout, "no capacity", 429 and 5xx answers) are retried with exponential backoff (500 ms, doubling, three retries by default; `connectRetries`, `connectBackoffMs` and `connectTimeoutMs` on `remote()`) **before** the render sees them, so a provider outage is not treated as a story crash. When the retries are spent the job fails at once with the reason (a `TargetLaunchError`), not through crash isolation.
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

## Scale to zero: `acquire` and `release`

`connect` is synchronous, so a provider that has to start, wake or pick something before a connection cannot do it there. Give `remote()` two optional hooks instead:

```ts
remote({
  name: "pool",
  engines: ["chromium"],
  // Describes the shape of the connection (here: it can route back to this host); not used to connect.
  connect: () => ({ protocol: "playwright", endpoint: "wss://pool.invalid/", exposeNetwork: "<loopback>" }),
  sessions: 4,
  acquireTimeoutMs: 20_000,
  // Before each connection: wake or start a server, pick one per shard.
  acquire: async ({ engine, buildId, shardIndex }) => {
    const server = await pool.wake(shardIndex ?? 0); // your provider's client
    return {
      protocol: "playwright",
      endpoint: server.endpoint,
      headers: { authorization: `Bearer ${server.token}` },
      exposeNetwork: "<loopback>",
      lease: server.id, // handed back to release, never logged
    };
  },
  // Once, after the render that used the connection finished, failed or was cancelled.
  release: async (lease, outcome) => {
    await pool.suspend(lease); // outcome: "finished" | "failed" | "cancelled"
  },
});
```

- `acquire` runs once per connection: a render, a shard, or a browser recycle. Calls can overlap, so shards of one build can each get their own server. `shardIndex` is the shard's 1-based position in the plan and is absent outside a sharded render.
- `release` runs exactly once for every successful `acquire`: when the render ends, fails or is cancelled, when a handshake fails after `acquire` (as `failed`, before the retry acquires again), and for leases still held when the runner shuts down (`cancelled`). A throw in `release` is logged without the lease or the error text and never fails the render.
- A throw in `acquire` is retried like a failed handshake (`connectRetries`, `connectBackoffMs`) and then fails the job with a `TargetLaunchError` reading `acquire failed: <message>`. It is treated as a service that may come back (the target stays offered); throw an error with `transient: false` for one that will not (a deleted server), which also marks the target unavailable. `acquireTimeoutMs` (default `connectTimeoutMs`) bounds each call, and a lease that arrives after the timeout is released at once.
- The connection `acquire` returns must keep the reach `connect` declared (`exposeNetwork` set or not): the planner decided between the loopback server and a signed URL from it, so a mismatch fails the render.
- `sessions` can be a function, read each time a page is about to start, for a provider whose cap changes with the servers it has woken.
- The endpoint, headers and anything inside `lease` are scrubbed from error text and never logged. Keep credentials in the endpoint, headers or lease, not in the error messages you throw.

The hooks are available on `remote()` for the Playwright runner. The Puppeteer runner's `cdp()` does not take them.

## Other services

- **Browserless** and other CDP services: `cdp({ name, endpoint, headers, sessions })` on the Puppeteer runner, or `remote({ connect: () => ({ protocol: "cdp", ... }) })` on the Playwright runner (Chromium only, and noticeably lower fidelity than Playwright's own protocol, which is acceptable because the target is its own engine with its own baselines). Both need a Storybook URL.
- **Azure Playwright Workspaces**: `azurePlaywright({ endpoint, token, os, sessions })`, with the workspace's browser endpoint (`PLAYWRIGHT_SERVICE_URL`) and access token; it passes `os` and the API version as query parameters.
- **BrowserStack**: `browserstack({ username, accessKey, os, browserVersion, engines, sessions })`; the credentials travel in the connection's capabilities and are scrubbed from messages. Needs a Storybook URL.
- Real devices and real Safari go through WebDriver and Appium, not a connect endpoint, and are not covered.
