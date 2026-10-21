# ADR 0033: Remote Browsers, Reachable Storybooks, and the Public Origin

## Status

Proposed

## Context

Capture is server-side (ADR 0003): the runner extracts the uploaded Storybook, serves it from a
static server on `127.0.0.1` (`runner-playwright/src/static-server.ts`) and launches a browser on
the same host (`chromium/firefox/webkit.launch()` in `runner-playwright/src/pipeline.ts`, and
`puppeteer.launch()` in `runner-puppeteer`). That host pays for every browser, and it can only
render the engines it can install.

Hosted browser services offer the same engines (and more) on someone else's machines: Azure App
Testing's Playwright Workspaces, BrowserStack, LambdaTest, Browserless (hosted or self-hosted),
Cloudflare Browser Rendering, AWS Bedrock AgentCore Browser, or a self-hosted
`playwright run-server` on any cloud. They all expose a browser over a WebSocket, so a runner can
drive one with the calls it already makes. Three things stand between the current runners and
any of them:

1. **The browser is always launched locally.** There is no way to connect to one elsewhere.
2. **The remote browser cannot reach the Storybook.** The static server binds loopback only.
3. **The capture fingerprint describes our host, not the browser.** `detectCaptureEnvironment`
   (`core/src/utils/environment.ts`) takes `platform` from `process.platform`/`process.arch` and
   `fontsHash` from `fc-list` on the machine running the runner. For a remote browser both are
   wrong. Since ADR 0031 phase 4 accepts a fingerprint mismatch as an environment migration, a
   fingerprint that cannot see the remote machine would let every provider-side image change
   through without a diff: the failure mode the ADR 0031 review spent three PRs removing.

Fixing (2) for providers that cannot tunnel needs an absolute URL to the published Storybook, and
building one needs to know the deployment's public origin. Today that is `config.publicBaseUrl`
(optional, `core/src/config.ts`): notification links are omitted without it (`app/src/notify.ts`),
OAuth and the well-known document fall back to the request origin. Many platforms generate a
deployment's URL, so a user cannot set `PUBLIC_URL` before the first deploy and has to redeploy.

## Decision

### 1. Remote browsers are an option on the existing runners, not new runner packages

`createPlaywrightCaptureRunner` and `createPuppeteerCaptureRunner` gain a `remote` option. With it,
the runner connects instead of launching:

- **Playwright:** `browserType.connect(endpoint, { headers, exposeNetwork })` for services that
  speak Playwright's own protocol (all three engines), or `chromium.connectOverCDP(endpoint, {
headers })` for Chrome-DevTools-only services (Chromium only).
- **Puppeteer:** `puppeteer.connect({ browserWSEndpoint, headers })`.
- Browser recycling (`recycleBrowserEvery`) opens a new remote session instead of relaunching.

Each provider is a **preset**, not a package: a function from credentials and the requested engine
and OS to `{ endpoint, headers, protocol, exposeNetwork? }`. Presets live next to the runner and are
plain configuration; a provider-specific package is justified only for something a connect
endpoint cannot do (real devices and real Safari, which go through WebDriver/Appium, ADR-worthy on
their own). Credentials are stored with the existing encrypted credentials, not environment
variables on a shared host.

### 2. A remote browser's environment is measured inside the browser

When `remote` is set the runner reports `CaptureEnvironment` from the browser it drove, never from
our host:

- `browserVersion`: `browser.version()`, which works over a connection.
- `platform`: the OS the preset requested, confirmed from the page (`navigator.userAgentData` /
  `navigator.platform`); never `process.platform`.
- `deviceScaleFactor`: `window.devicePixelRatio` from the page.
- `fontsHash`: a digest computed in the page over a fixed probe list of font families
  (`document.fonts.check`), or omitted. `fc-list` describes our host and must not be used.

A field the runner cannot determine is omitted, and ADR 0031's rule that an unknown component is
not a change (#203) keeps an omission from reading as a migration.

### 3. Remote captures are their own engine

A remote capture's engine is named `<engine>@<preset>` (for example `chromium@browserstack`). It
gets its own baselines (ADR 0028's per-engine baselines) and never compares against a local
render of the same engine: different hosts, fonts and GPU paths would turn every comparison into
noise or, worse, into migrations. Moving a project from local to remote is then an explicit
"new engine" bootstrap, as enabling a new local engine already is.

### 4. Concurrency is counted in sessions, and session failures are retried

- With `remote`, the page limiter uses a fixed cap from the preset (the plan's parallel-session
  limit) instead of sizing pages from our CPU and memory (`utils/page-limiter.ts`). One render
  call may hold several sessions; shards (ADR 0031 phase 5) map onto sessions naturally.
- Connection-level failures (a dropped WebSocket, "no capacity", a session that never starts) are
  retried with backoff before the render pass sees them. Crash isolation (`capture/isolate.ts`)
  must only ever see a browser that died while rendering, so that a provider outage is not
  bisected down to a "poison" story.

### 5. Reaching the Storybook: `exposeNetwork` first, signed URLs otherwise

- **Playwright `connect` providers that support it** (Azure Playwright Workspaces, a self-hosted
  Playwright server): pass `exposeNetwork: "<loopback>"`. The remote browser's requests for
  `127.0.0.1` are routed back through the connection to our host, so the existing static server
  works unchanged. Nothing new is exposed.
- **Everyone else** (CDP-only services, Puppeteer, providers that only offer a tunnel): the
  runner is given a **signed URL** to the build's published Storybook instead of the loopback
  server.

**Signed URL shape.** The token is a path prefix, because a Storybook loads `iframe.html` and then
many assets by relative path; a token on a single file URL would not reach them:

```
<publicOrigin>/s/<token>/projects/<slug>/storybook/build/<buildId>/iframe.html
```

The app strips the `/s/<token>` prefix, checks the token, and serves the existing route
(`app/src/routers/storybook.ts`, `/projects/:slug/storybook/build/:buildId/*`) as if
`canViewBuild` had passed.

**Token.** `base64url(projectId, buildId, expiresAt) + "." + HMAC-SHA256(key, same)`, with `key`
derived from `config.secret` for this single purpose (so a token can never be confused with a
session or another signature). It is verified statelessly, grants read-only access to one build's
static files and nothing else (no landing page, no API, no other build), and expires shortly after
the capture's render budget. Remote workers already receive `secret`, so they can mint tokens.

Published Storybooks on `publishedBaseDomain` subdomains (ADR 0011) are not used for signed URLs:
the app only builds those links (`core/src/urls.ts`), it does not serve those hosts itself, so
whether a subdomain reaches this app depends on a proxy outside it.

### 6. The public origin is resolved from a chain, and learnt on first admin use

Anything that needs an absolute URL in the background (signed Storybook URLs, email links,
commit-status links) asks one resolver, which tries in order:

1. **Explicit configuration:** `config.publicBaseUrl`.
2. **Platform environment variables**, mapped by a `detectPublicBaseUrl(env)` helper in core next
   to `detectResources()`. Platforms that publish their own address include Heroku
   (`HEROKU_APP_DEFAULT_DOMAIN_NAME`, with the `runtime-dyno-metadata` Labs feature), Railway
   (`RAILWAY_PUBLIC_DOMAIN`, when the service has a domain), Vercel, Netlify, Render, Fly.io,
   Azure App Service, Azure Container Apps and DigitalOcean App Platform; the exact variables are
   pinned in the helper's tests when it is written. Cloud Run's URL is deterministic but not
   injected; AWS App Runner, Lambda function URLs and Cloudflare Workers expose none. These give
   the platform's own domain, which is a working fallback but the wrong link when a custom domain
   fronts the app.
3. **The origin an authenticated admin actually used.** The System page reports the browser's
   `location.origin` back to the app (a same-origin, CSRF-protected POST from the page's existing
   script layer), the app stores it, and the page shows it as "detected from your browser" for the
   admin to confirm or replace. The browser's view is used, not the server's: the app does no
   proxy normalization, so behind a TLS-terminating proxy `c.req.url` is the internal
   `http://host:port`. Background jobs and remote workers read the stored value from the database
   they already share. This removes the redeploy on every host: the first admin visit to the
   System page teaches the app its address.
4. **Nothing found:** features that need an absolute URL are off, with a notice naming the
   setting, rather than guessed.

The `Host` / `X-Forwarded-Host` of an arbitrary request is never used: a background job has none,
and both can be forged to plant attacker-controlled links in emails and commit statuses. The same
resolver is the place for links that are relative today; commit statuses are posted with a path
`target_url` (`/projects/<slug>/builds/<id>`, `core/src/capture/dispatch.ts`), which should be made
absolute through it (to be confirmed against what GitHub and GitLab accept).

## Consequences

**Positive**

- Any connect-capable provider works through one code path and a preset; adding a provider is
  configuration, not a package.
- With `exposeNetwork`, remote capture needs no new public surface at all.
- Remote captures can never be compared against local ones, and their fingerprint describes the
  machine that rendered them, so provider image changes are diffed, not waved through.
- The public origin stops being a first-deploy chicken-and-egg problem, and email and commit-status
  links get a correct absolute origin even without remote browsers.

**Negative**

- Each screenshot crosses the internet: slower per page than a local browser, paid back only by
  parallelism the user does not have to host.
- Provider browser builds move under us. The fingerprint will catch it, but every move is a
  baseline migration on the default branch; pinning the browser version in the preset is the
  user's job.
- The signed-URL route is a new way to read a private Storybook from outside. It is narrow (one
  build, static files, short expiry) but needs its own security review before it ships.
- The customer's Storybook, possibly unreleased UI, is rendered by a third party. Remote capture is
  opt-in per project.
- Playwright `connect` requires compatible client and server versions, which ties our
  `playwright-core` upgrades to each provider's supported range.

## Alternatives considered

- **One package per provider** (`runner-browserstack`, …). Rejected: every provider would
  re-solve the same three problems; the differences are an endpoint and its capabilities.
- **A tunnel binary** (BrowserStack Local, Sauce Connect) as the only way in. Kept as a preset
  option, not the default: it is an extra process per host, and signed URLs cover the same need
  without third-party software.
- **Public URL from the `Host` header.** Rejected: forgeable, and absent in background work.
- **WebdriverIO as the remote runner.** Deferred: the right tool for real devices and real Safari,
  wrong as the default (sessions instead of pages, unpinned browser builds). A future ADR if
  someone needs device coverage.

## Open questions

- Confirm that Storybook 8, 9 and 10 static builds load every asset by relative path, so the
  path-prefix token reaches them all (the three fixtures settle it). `architecture.md` describes
  Storybook as expecting root serving; the path-based build route already works, which suggests
  relative paths, but it has not been checked against every fixture.
- Which providers honour `exposeNetwork` beyond Azure and a self-hosted Playwright server.
- Whether commit-status APIs accept the relative `target_url` posted today.

## Implementation order

1. Sections 1-4 for Playwright `connect` with `exposeNetwork`, tested against a self-hosted
   Playwright server (no vendor account, no new public route).
2. Section 6 (public origin resolver), which also fixes absolute links for email and commit
   statuses on its own.
3. Section 5's signed URLs, after a security review; this unlocks Puppeteer and CDP-only services.
4. Presets for specific providers, as users ask for them.
