# ADR 0033: Remote Browsers, Reachable Storybooks, and the Public Origin

## Status

Proposed. Companion to ADR 0034 (one deployable, a database queue, no separate worker, and the
`testing` umbrella option). This ADR assumes it: remote browsers are how rendering scales, and every
app instance runs the same configuration.

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
any of them, and a fourth concerns the engines they already claim locally:

1. **The browser is always launched locally.** There is no way to connect to one elsewhere.
2. **The remote browser cannot reach the Storybook.** The static server binds loopback only.
3. **The capture fingerprint describes our host, not the browser.** `detectCaptureEnvironment`
   (`core/src/utils/environment.ts`) takes `platform` from `process.platform`/`process.arch` and
   `fontsHash` from `fc-list` on the machine running the runner. For a remote browser both are
   wrong. Since ADR 0031 phase 4 accepts a fingerprint mismatch as an environment migration, a
   fingerprint that cannot see the remote machine would let a provider-side image change through without a diff and, on the default branch,
   rewrite the baselines: the failure mode the ADR 0031 review spent three PRs removing.
4. **Local engines are claimed, not checked.** `createPlaywrightCaptureRunner` advertises every
   engine name whatever is installed (`supportedBrowsers ?? BROWSER_NAMES`), so a project that picks
   Firefox on a host without it fails mid-capture with Playwright's launch error, which crash
   isolation (`capture/isolate.ts`) then retries as if a story had crashed. `chrome` is not Chrome
   in either runner: Playwright's `launchBrowser` has no `chrome` branch (it falls through to the
   bundled Chromium) and Puppeteer never passes the engine name to `launch`.

Fixing (2) for providers that cannot tunnel needs an absolute URL to the published Storybook, and
building one needs to know the deployment's public origin. Today that is `config.publicBaseUrl`
(optional, `core/src/config.ts`): notification links are omitted without it (`app/src/notify.ts`),
OAuth and the well-known document fall back to the request origin. Many platforms generate a
deployment's URL, so a user cannot set `PUBLIC_BASE_URL` before the first deploy and has to redeploy.

## Decision

### 1. A runner declares everything it can render in one `browsers` list

`createPlaywrightCaptureRunner` and `createPuppeteerCaptureRunner` take `browsers`: a list of every
**target** the runner offers, local and remote. An entry is one of:

- a bare engine name, `"chromium"`: a local engine with the runner's defaults;
- `local(engine, options)`: a local engine with options (Playwright's `channel`, Puppeteer's
  `executablePath`);
- a **remote preset**, one value standing for one remote service, which expands to one or more
  targets (`playwrightServer(...)`, `azurePlaywright(...)`, `browserstack(...)`, `cdp(...)`, or the
  generic `remote(...)`).

The runner flattens the list into its targets. It is a list, not an object keyed by target, so that
two entries producing the same target are visible to the runner and rejected (an object spread
would overwrite one silently).

- **Default:** omitted, `browsers` is `["chromium"]`. Firefox and WebKit are no longer claimed by
  default; an operator who provisioned them lists them. This is a breaking change (Consequences).
- **Primary target:** the first target of the flattened list is the runner's default, what a
  project with no `browsers` setting resolves to. It replaces the `DEFAULT_BROWSER` fallback in
  `resolveBrowsers` and the runner-wide `supportedBrowsers`.
- **Projects keep their stored targets.** Every project row stores a `browser` (default `'chromium'`)
  and optionally `browsers`, so the runner's default applies to new projects only: a project created
  through an instance starts with that runner's default target. An existing project that names a target
  the runner does not offer fails its builds at once, with that reason (the capture-time
  `assertSupportedBrowsers` check exists today), and the System page lists such projects. This covers
  Firefox and WebKit projects when the default narrows to Chromium, and every existing project when a
  runner lists no local engines.
- **No local engines:** a list with no bare or `local()` entries has none; the host needs no
  installed browsers (decision 7).
- **Remote mechanics:**
  - Playwright: `browserType.connect(endpoint, { headers, exposeNetwork })` for services that speak
    Playwright's own protocol (all three engines), or
    `chromium.connectOverCDP(endpoint, { headers })` for Chrome-DevTools-only services (Chromium
    only).
  - Puppeteer: `puppeteer.connect({ browserWSEndpoint, headers })`.
  - Browser recycling (`recycleBrowserEvery`) opens a new remote session instead of relaunching.
  - `connectOverCDP` is a fallback. ADR 0031 rejected it as significantly lower fidelity than
    `browserType.connect()`. It stays as the Chromium-only route for services with no other
    protocol, and what makes that acceptable is that such a target is its own engine with its own
    baselines and fingerprint (decisions 2 and 3), so a fidelity difference is never compared
    against a local render.
- **Presets are plain configuration, not packages.** Each is a function returning
  `{ name, protocol, endpoint, headers, exposeNetwork?, sessions, engines }`. A provider-specific
  package is justified only for something a connect endpoint cannot do (real devices and real
  Safari, which go through WebDriver/Appium, ADR-worthy on their own).
- **`engines` picks a subset** of what the service offers; without it a preset offers all of them.
  A Chromium-only service cannot offer `firefox`, which fails when the runner is created.
- **Credentials are operator-level only** for now: passed to the preset in the server's code, from
  the environment or a secret manager, like every other adapter's credentials. Per-project
  credentials (a project owner bringing their own provider account through ADR 0030's user
  connections and the encrypted credentials store) are a later step.

### 2. A remote browser's environment is measured inside the browser

For a remote target the runner reports `CaptureEnvironment` from the browser it drove, never
from our host:

- `browserVersion`: `browser.version()`, which works over a connection.
- `platform`: the OS the preset requested, confirmed from the page (`navigator.userAgentData` /
  `navigator.platform`); never `process.platform`.
- `deviceScaleFactor`: `window.devicePixelRatio` from the page.
- `fontsHash`: a digest computed in the page over a fixed probe list of font families
  (`document.fonts.check`), or omitted. `fc-list` describes our host and must not be used.

A field the runner cannot determine is omitted, and ADR 0031's rule that an unknown component is
not a change (#203) keeps an omission from reading as a migration.

### 3. Remote captures are their own engine, and a target's name is data

A remote target is named `<engine>@<name>`, where `<name>` is the preset's `name` option or its
fixed default (`browserstack`, `grid`, ...): `chromium@browserstack`. It gets its own baselines
(ADR 0028's per-engine baselines) and never compares against a local render of the same engine:
different hosts, fonts and GPU paths would turn every comparison into noise or, worse, into
migrations. Moving a project from local to remote is then an explicit "new engine" bootstrap, as
enabling a new local engine already is.

The name is stored: it is the value of `snapshots.browser` and part of every baseline key. So it
comes only from `name` or the preset's fixed default, never from anything that changes (the OS, a
browser version, the endpoint URL), and renaming a target starts fresh baselines for it, as
switching engines does. Two entries of one preset (Windows and macOS on BrowserStack) need an
explicit `name` on at least one; a collision fails when the runner is created, naming both entries.
The advice is to set `name` before the first build if you will ever have two. A `name` is limited to
lowercase letters, digits and hyphens, starts with a letter or digit and is at most 32 characters,
because it becomes part of a storage key and a unique index; anything else fails when the runner is
created.

### 4. Concurrency is counted in sessions, and session failures are retried

- For a remote target, the page limiter uses a fixed cap from the preset (the plan's parallel-session
  limit) instead of sizing pages from our CPU and memory (`utils/page-limiter.ts`). One render
  call may hold several sessions; shards (ADR 0031 phase 5) map onto sessions naturally.
- Connection-level failures (a dropped WebSocket, "no capacity", a session that never starts) are
  retried with backoff before the render pass sees them. Crash isolation (`capture/isolate.ts`)
  must only ever see a browser that died while rendering, so that a provider outage is not
  \1- **The limit is per target and per process.** Today's page limiter is created per render call, so
  with several concurrent shards a `sessions` cap would multiply. Remote targets share one limiter
  per target for the whole process, and `sessions` bounds it.

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

The app strips the `/s/<token>` prefix, checks the token, and serves the build's static files
through the same file-serving branch as the existing route (`app/src/routers/storybook.ts`,
`/projects/:slug/storybook/build/:buildId/*`) as if `canViewBuild` had passed. It never serves the
project and build wrapper page that route returns for an empty path.

**Token.** `base64url(projectId, buildId, expiresAt) + "." + HMAC-SHA256(key, same)`. It is verified
statelessly and grants read-only access to one build's static files and nothing else (no wrapper page,
no API, no other build).

- **Key.** Derived from `config.secret` with a fixed context string (`storyshelf/storybook-url/v1`), so
  a token can never be confused with a session or any other signature. `secret` is optional today:
  without it every `reach: "url"` target is `unavailable: "no secret"`. During a rotation the token is
  also accepted if it verifies against `previousSecret`.
- **Expiry.** A per-job token with a default lifetime of 2 hours (`testing.storybookUrlTtl`). The
  render budget is per render call and crash isolation can make dozens of passes, so a lifetime tied to
  one budget would expire mid-render and show up as story failures; a fixed, generous bound is simpler
  and still short.
- **Where it applies.** The render request and the `extractParameters` input both carry
  `storybookUrl`.
- **Hygiene.** The token is redacted from logs and attempt records, and from error messages the
  runner surfaces.

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
   `http://host:port`. Background jobs, which run inside an app instance, read the stored value from
   the database. This removes the redeploy on every host: the first admin visit to the
   System page teaches the app its address. It is stored in a small `site_settings` key-value table
   (DDL in the three dialects and a new `Tables` key) and written only through a site-admin,
   CSRF-protected route. With authentication disabled there is no admin, so nothing is learned and
   the origin must come from configuration or the platform.
   \1
   **Nothing resolved does not stop the app.** Targets that need a URL (`reach: "url"`) are
   `unavailable: "no public origin"` until one resolves, so a first deploy starts, an admin opens the
   System page, and the targets become ready.

The `Host` / `X-Forwarded-Host` of an arbitrary request is never used: a background job has none,
and both can be forged to plant attacker-controlled links in emails and commit statuses. The same
resolver is the place for links that are relative today; commit statuses are posted with a path
`target_url` (`/projects/<slug>/builds/<id>`, `core/src/capture/dispatch.ts`), which should be made
absolute through it (to be confirmed against what GitHub and GitLab accept).

### 7. Local engines are declared and verified, and can be absent

Declaring an engine does not prove it is installed, so the runner checks. When it starts, each local
target is verified without launching anything: Playwright asks the browser type for its
`executablePath()` and checks that the file exists; Puppeteer checks its configured executable (`puppeteer-core` ships no browser, so a Puppeteer
runner with no `executablePath` has its local targets `unavailable`). The result is part of the runner's metadata, per target, `ready` or
`unavailable` with a reason, and is shown on the System page ("firefox: declared, not installed").

- A project setting that names an unavailable target is refused when it is saved, with the reason.
- The existence check cannot see missing system libraries. A launch that fails anyway marks the
  target unavailable with the launch error, and the job fails at once with that error instead of
  being retried through crash isolation: a launch failure is not a story's fault, and isolation
  must only see a browser that died while rendering.
- `chrome` becomes real. In Playwright, `local("chrome", { channel: "chrome" })` launches with that
  channel (it needs `playwright install chrome`); in Puppeteer it needs an `executablePath`, and a
  bare `"chrome"` without one fails when the runner is created. A bare `"chrome"` in Playwright
  means the `chrome` channel.

With no local entries the host needs no browsers at all (`playwright-core` only, no
`playwright install`), which removes the browsers' memory and CPU, by far the largest part of a
capture host's load. It does not make the host idle. What still runs locally:

- **Diffing.** PNG decode, `pixelmatch` and overlay encode run in the diff worker pool on this
  host. The separate compare stage (ADR 0031, not built) is what would move diffing elsewhere.
- **Parameter extraction.** `extractParameters` opens one page to read Storybook's resolved
  parameters before rendering (`runner-playwright/src/capture-runner.ts`); with no local engines
  it runs on the project's primary target, as the orchestrator passes it today (`browsers[0]`). Only the
  Playwright runner implements it.
- **Extraction and serving.** Unzipping the build to scratch and, for `exposeNetwork` targets,
  serving it to the remote browser over the connection.
- **Screenshot transfer.** Every PNG comes back over the WebSocket and is written to storage.

Legacy snapshot and baseline rows with no `browser` keep meaning local `chromium`: that is what
produced them.

## API

### Operator: declaring what a runner offers

Playwright, local engines only (the common case, and what an existing server needs to keep
Firefox and WebKit after the default narrows to Chromium):

```ts
import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";

createPlaywrightCaptureRunner({ browsers: ["chromium", "firefox", "webkit"] });
// omitted → ["chromium"]
```

The binaries are still provisioned separately; `playwright-core` never downloads them:

```sh
# once per machine or image, pinned to your playwright-core version
npx -y playwright@<version> install --with-deps chromium firefox webkit
```

Mixing local and remote targets, with a preset per service:

```ts
import { createPlaywrightCaptureRunner, local } from "@storyshelf/runner-playwright";
import {
  azurePlaywright,
  browserstack,
  playwrightServer,
} from "@storyshelf/runner-playwright/remote";

const runner = createPlaywrightCaptureRunner({
  browsers: [
    "chromium", // local; the first target is the default for projects with no setting
    local("chrome", { channel: "chrome" }),
    playwrightServer({
      name: "grid",
      endpoint: "ws://playwright:3000/",
      exposeNetwork: "<loopback>", // reaches the 127.0.0.1 Storybook server; no signed URL needed
      sessions: 8, // concurrency cap; replaces CPU/memory-based page sizing
    }), // → chromium@grid, firefox@grid, webkit@grid
    azurePlaywright({
      endpoint: process.env.PLAYWRIGHT_SERVICE_URL!,
      token: process.env.PLAYWRIGHT_SERVICE_ACCESS_TOKEN!,
      os: "linux",
      sessions: 20,
    }), // → chromium@azure, firefox@azure, webkit@azure
    browserstack({
      username: process.env.BROWSERSTACK_USERNAME!,
      accessKey: process.env.BROWSERSTACK_ACCESS_KEY!,
      os: { name: "Windows", version: "11" },
      engines: ["chromium", "chrome"],
      sessions: 5,
      // no exposeNetwork: this service needs a signed Storybook URL (decision 5)
    }), // → chromium@browserstack, chrome@browserstack
    browserstack({
      name: "bs-mac", // a second entry of one preset needs its own name
      username: process.env.BROWSERSTACK_USERNAME!,
      accessKey: process.env.BROWSERSTACK_ACCESS_KEY!,
      os: { name: "OS X", version: "Sonoma" },
      engines: ["webkit"],
    }), // → webkit@bs-mac
  ],
});

createShelfApp({ database, storage, testing: { runner } }); // `capture` is renamed in ADR 0034
```

Every preset is sugar over one generic constructor, so a provider without a preset needs no new
release:

```ts
remote({
  name: "mygrid",
  engines: ["chromium", "firefox", "webkit"],
  connect: (engine: BrowserName) => ({
    protocol: "playwright", // or "cdp" (Chromium only)
    endpoint: "wss://…",
    headers: { authorization: "Bearer …" },
    exposeNetwork: "<loopback>", // omit when the service cannot route back to us
  }),
  sessions: 4,
  platform: "linux-x64", // reported in the fingerprint when the page cannot tell (decision 2)
});
```

Puppeteer takes the same option with its own constraints: Chromium-family engines only, `local()`
takes an `executablePath`, and remote entries are CDP only with no `exposeNetwork`, so every
Puppeteer remote target needs a signed URL:

```ts
import { createPuppeteerCaptureRunner, local } from "@storyshelf/runner-puppeteer";
import { cdp } from "@storyshelf/runner-puppeteer/remote";

createPuppeteerCaptureRunner({
  executablePath: "/usr/bin/chromium", // the executable bare entries launch
  browsers: [
    "chromium", // uses the runner's `executablePath`
    local("chrome", { executablePath: "/usr/bin/google-chrome" }),
    cdp({
      name: "cloudflare",
      endpoint: "wss://…",
      headers: { authorization: `Bearer ${token}` },
      sessions: 4,
    }),
    // → chromium@cloudflare
  ],
  args: ["--no-sandbox"], // local engines only; replaces the default low-memory flags
});
```

`local("firefox")` on the Puppeteer runner fails when the runner is created: this runner cannot
drive it. Presets validate eagerly: a CDP-only preset offering `firefox`, an empty list, or two
entries with one target throws at creation, not when the first build runs.

There is deliberately one runner per server. Mixing a Puppeteer and a Playwright runner (a
`composeRunners` helper) was considered and rejected: see Alternatives.

### Project: choosing targets

The project's `browsers` setting is a list of **capture targets** instead of engines:

```ts
type CaptureTarget = BrowserName | `${BrowserName}@${string}`;

// Settings → Capture, or the project update API:
//   { "browsers": ["chromium", "chromium@browserstack", "webkit@grid"] }
```

- The engine half is checked against `BROWSER_NAMES`, the name half against the runner's targets;
  `MAX_BROWSERS` (3) counts targets.
- Saving a target the runner does not offer, or that is `unavailable`, is rejected at save time with
  the list of targets it does offer. Today the save-time check only validates the static engine list and
  `assertSupportedBrowsers` runs at capture time, as a failed build, so this check is new.
- `snapshots.browser` and baseline keys are text already, so a target needs no schema change; each
  target gets its own baselines (decision 3).

This is a breaking change, made cleanly rather than with aliases: `BrowserName` stays the type of a
rendering engine, and everything that stores, compares or validates a project's engines moves to
`CaptureTarget`. `resolveBrowsers` returns targets; code that launches or connects splits a target
into its engine and name with one helper (`parseTarget`).

### Contract between core and the runner

```ts
interface CaptureRunnerMetadata {
  // replaces `supportedBrowsers`; the first entry is the default target
  targets: readonly {
    target: CaptureTarget;
    reach: "loopback" | "url"; // how the browser reaches the Storybook (decision 5)
    status: "ready" | { unavailable: string }; // decision 7
  }[];
}

interface RenderRequest {
  target: CaptureTarget; // replaces `browser`
  storybookDir: string; // always: the extracted build on this host
  storybookUrl?: string; // set by core for `reach: "url"` targets: a signed, absolute URL
  // …existing fields unchanged
}
```

For a `reach: "url"` target, core mints the token, resolves the public origin (decision 6) and puts
`storybookUrl` on the render request and on the `extractParameters` input; the runner navigates there
instead of to its loopback server. While no public origin resolves, or no `secret` is set, such a
target is `unavailable`: a settings save that names it is refused and a build of a project that already
does fails at once with that reason, so builds never fail one by one with an unexplained error.

### Scaling out

There is no separate worker (ADR 0034): every app instance runs the same `testing` configuration,
so every instance has the same `browsers` list and validates project settings against the runner it
already holds. Rendering scales on the browser side, not by adding processes that need database
access.

- **Pools that differ are presets.** A Firefox and WebKit pool and a Chromium pool are two presets
  with their own endpoints (`firefox@pool-b`, `chromium@pool-a`). Each target maps to its endpoint,
  so no job routing is needed, and one job still renders all of a project's engines.
- **`sessions` is per app instance.** When several instances share one provider plan, the operator
  divides the provider's parallel-session limit among them. For a self-hosted farm the cap belongs at
  the farm (Browserless's `CONCURRENT` and `QUEUED`, or a proxy in front of a Playwright server). A
  shared limit across instances (session leases in the database) is not built; add it only if
  over-provisioning when the app scales turns out to be a real problem. A provider refusing a
  session for capacity is retried with backoff (decision 4), so exceeding the limit costs time, not
  builds.
- **A target an instance does not offer cannot reach a job,** because instances share one
  configuration and a settings save for an unknown or unavailable target is refused (decision 7).

## Amendments to existing ADRs

- **0028:** engine identity becomes a capture target, `<engine>@<name>` for remote ones, and the
  per-engine storage key (`<mode>~<browser>`) carries it. "Puppeteer supports only Chromium" still
  holds.
- **0015:** `metadata.supportedBrowsers` is replaced by `metadata.targets`, `RenderRequest.browser` by
  `target`, and the request gains an optional `storybookUrl`.
- **0031 phase 4:** for a remote target, platform and fonts come from the browser and not from the host
  running the runner. Phase 4's note that `connectOverCDP` is lower fidelity is respected (decision 1).
- **0003:** launching a browser is no longer always local.
- **0011:** a token-authorised read route to a build's static files is added, for the signed-URL
  case.

Each amended ADR gets a one-line pointer to this one in the same PR.

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

- **Breaking default.** Today the Playwright runner claims Firefox and WebKit without checking.
  After this change a server whose projects use them stops offering them until the operator lists
  them in `browsers`; the System page and the save-time refusal make that visible, and the upgrade
  notes must say it.
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
- **A `remotes` object plus `local` and `defaultTarget` options** (an earlier draft). Replaced by
  the single `browsers` list: operators also need to say which engines are available locally, the
  first entry already defines the default, and a list lets the runner reject duplicates that an
  object spread would hide.
- **Several runner types at once (`composeRunners`).** Rejected. The orchestrator renders one
  engine at a time per job, so there is no parallelism between runner types to gain; the real
  reason to mix (local plus several remote services) is already one runner with a `browsers` list;
  Puppeteer next to Playwright saves nothing, since Playwright's headless Chromium is also
  chrome-headless-shell; and rendering one engine with two runners lets browser version and fonts
  differ, which the fingerprint reads as a migration.
- **Per-engine worker pools** (a Firefox pool, a Chromium pool, as separately configured workers).
  Not needed: pools are presets with their own endpoints (see Scaling out). Routing jobs to pools
  would need engine-level jobs, which reverses ADR 0031 phase 5's choice to keep a story's engines in
  one shard so a newly enabled engine can bootstrap from its sibling.
- **WebdriverIO as the remote runner.** Deferred: the right tool for real devices and real Safari,
  wrong as the default (sessions instead of pages, unpinned browser builds). A future ADR if
  someone needs device coverage.

## Open questions

- Confirm that Storybook 8, 9 and 10 static builds load every asset by relative path, so the
  path-prefix token reaches them all (the three fixtures settle it). `architecture.md` describes
  Storybook as expecting root serving; the path-based build route already works, which suggests
  relative paths, but it has not been checked against every fixture. Settled by a short spike: serve each
  fixture build under a path prefix and load `iframe.html`.
- Which providers honour `exposeNetwork` beyond Azure and a self-hosted Playwright server. Settled by testing against
  `run-server`; a provider not shown to support it is treated as `reach: "url"`, the safe default.
- Whether commit-status APIs accept the relative `target_url` posted today. Checked on a throwaway repository. Either
  way the fix is to build the link absolute with the public-origin resolver, and to omit `target_url`
  when no origin is known (GitHub's API is believed to treat it as optional; unverified).

## Implementation order

1. **Local `browsers` list and the installed-engine check**, with the Chromium-only default, the
   `CaptureTarget` type and the `chrome` fix. `parseBrowsers`, the project API enum and the settings
   validation accept targets in the same release; otherwise `chromium@grid` would be silently dropped
   back to the single legacy `browser`. No remote code, no new public route, and it fixes
   problem 4 on its own, so it ships first.
2. **Remote targets for Playwright** (`connect` with `exposeNetwork`, in-browser fingerprint,
   sessions, retries, `<engine>@<name>` baselines), tested against a self-hosted Playwright server
   (no vendor account). That test also answers whether a bare `run-server` has authentication or a
   concurrency cap. This step ships the self-hosted farm guide, the test that fails when the guide's
   pinned version drifts from `playwright-core`, and the clear connect-time error for a client and
   server version mismatch (ADR 0034 decision 7).
3. **The public origin resolver** (decision 6), which also fixes absolute links for email and
   commit statuses on its own.
4. **Signed URLs** (decision 5), after a security review; this unlocks Puppeteer and CDP-only
   services.
5. **Presets for specific providers**, as users ask for them.
