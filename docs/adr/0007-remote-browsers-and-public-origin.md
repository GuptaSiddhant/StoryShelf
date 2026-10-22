# ADR 0007: Remote Browsers, Reachable Storybooks, and the Public Origin

## Status

Accepted.

Supersedes (archived): ADR 0033.

Companion to ADR 0006 (Testing Option, Hosting-Only Mode and the Database Queue): there is one
deployable and no separate worker, so remote browsers are how rendering scales, and every app
instance runs the same configuration.

## Context

Capture is server-side (ADR 0004, Capture Pipeline): the runner extracts the uploaded Storybook,
serves it from a static server on `127.0.0.1` (`runner-playwright/src/static-server.ts`) and drives a
browser. A host that launches every browser locally pays for every browser, and can only render the
engines it can install.

Hosted browser services offer the same engines (and more) on other machines: Azure App Testing's
Playwright Workspaces, BrowserStack, LambdaTest, Browserless (hosted or self-hosted), Cloudflare
Browser Rendering, AWS Bedrock AgentCore Browser, or a self-hosted `playwright run-server` on any
cloud. They all expose a browser over a WebSocket, so a runner can drive one with the calls it
already makes. Using them raises four problems:

1. **Connecting.** A runner has to be able to connect to a browser elsewhere, not only launch one.
2. **Reachability.** The static server binds loopback only, so a remote browser cannot reach the
   Storybook.
3. **Fingerprint.** `detectCaptureEnvironment` (`core/src/utils/environment.ts`) reads `platform`
   from `process.platform`/`process.arch` and `fontsHash` from `fc-list` on the machine running the
   runner. For a remote browser both describe the wrong machine. Because a fingerprint mismatch is
   accepted as an environment migration (ADR 0005, Capture Performance and Sharding), a fingerprint
   that cannot see the remote machine would let a provider-side image change through without a diff
   and, on the default branch, rewrite the baselines.
4. **Local engines must be checked, not claimed.** A runner that advertises every engine name
   whatever is installed fails mid-capture with a launch error for a project that picks a missing
   engine, and crash isolation (`capture/isolate.ts`) then retries it as if a story had crashed. The
   name `chrome` must also mean Chrome, not a fallback to bundled Chromium.

Reaching the Storybook from providers that cannot tunnel needs an absolute URL to the published
Storybook, which needs the deployment's public origin. Many platforms generate a deployment's URL,
so an operator cannot always set `PUBLIC_BASE_URL` before the first deploy.

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

- **Default:** omitted, `browsers` is `["chromium"]`. Firefox and WebKit are offered only when an
  operator who provisioned them lists them.
- **Primary target:** the first target of the flattened list is the runner's default, what a
  project with no `browsers` setting resolves to.
- **Projects keep their stored targets.** Every project row stores a `browser` (default
  `'chromium'`) and optionally `browsers`, so the runner's default applies to new projects only: a
  project created through an instance starts with that runner's default target. A project that
  names a target the runner does not offer fails its builds at once, with that reason
  (`assertSupportedBrowsers` at capture time), and the System page lists such projects.
- **No local engines:** a list with no bare or `local()` entries has none; the host needs no
  installed browsers (decision 7).
- **Remote mechanics:**
  - Playwright: `browserType.connect(endpoint, { headers, exposeNetwork })` for services that speak
    Playwright's own protocol (all three engines), or `chromium.connectOverCDP(endpoint, { headers })`
    for Chrome-DevTools-only services (Chromium only).
  - Puppeteer: `puppeteer.connect({ browserWSEndpoint, headers })`.
  - Browser recycling (`recycleBrowserEvery`) opens a new remote session instead of relaunching.
  - `connectOverCDP` is a fallback: it is significantly lower fidelity than `browserType.connect()`.
    It stays as the Chromium-only route for services with no other protocol, and it is acceptable
    because such a target is its own engine with its own baselines and fingerprint (decisions 2 and
    3), so a fidelity difference is never compared against a local render.
- **Presets are plain configuration, not packages.** Each is a function returning
  `{ name, protocol, endpoint, headers, exposeNetwork?, sessions, engines }`. A provider-specific
  package is justified only for something a connect endpoint cannot do (real devices and real
  Safari, which go through WebDriver/Appium, ADR-worthy on their own).
- **`engines` picks a subset** of what the service offers; without it a preset offers all of them.
  A Chromium-only service cannot offer `firefox`, which fails when the runner is created.
- **Credentials are operator-level only**: passed to the preset in the server's code, from the
  environment or a secret manager, like every other adapter's credentials. Per-project credentials
  (a project owner bringing their own provider account through user connections, ADR 0011,
  Authentication and Access) are a later step.

### 2. A remote browser's environment is measured inside the browser

For a remote target the runner reports `CaptureEnvironment` from the browser it drove, never from
the host running the runner:

- `browserVersion`: `browser.version()`, which works over a connection.
- `platform`: the OS the preset requested, confirmed from the page (`navigator.userAgentData` /
  `navigator.platform`); never `process.platform`.
- `deviceScaleFactor`: `window.devicePixelRatio` from the page.
- `fontsHash`: a digest computed in the page over a fixed probe list of font families
  (`document.fonts.check`), or omitted. `fc-list` describes the host and is not used.

A field the runner cannot determine is omitted, and the rule that an unknown fingerprint component
is not a change (ADR 0005) keeps an omission from reading as a migration.

### 3. Remote captures are their own engine, and a target's name is data

A remote target is named `<engine>@<name>`, where `<name>` is the preset's `name` option or its
fixed default (`browserstack`, `grid`, ...): `chromium@browserstack`. It gets its own baselines (the
per-engine baselines of ADR 0004) and never compares against a local render of the same engine:
different hosts, fonts and GPU paths would turn every comparison into noise or, worse, into
migrations. Moving a project from local to remote is an explicit "new engine" bootstrap, as enabling
a new local engine is.

The name is stored: it is the value of `snapshots.browser` and part of every baseline key (the
per-engine storage key `<mode>~<browser>` carries the full target). So it comes only from `name` or
the preset's fixed default, never from anything that changes (the OS, a browser version, the
endpoint URL), and renaming a target starts fresh baselines for it, as switching engines does.

- Two entries of one preset (Windows and macOS on BrowserStack) need an explicit `name` on at least
  one; a collision fails when the runner is created, naming both entries. Operators who may ever have
  two should set `name` before the first build.
- A `name` is limited to lowercase letters, digits and hyphens, starts with a letter or digit and is
  at most 32 characters, because it becomes part of a storage key and a unique index; anything else
  fails when the runner is created.

### 4. Concurrency is counted in sessions, and session failures are retried

- For a remote target, the page limiter uses a fixed cap from the preset (`sessions`, the plan's
  parallel-session limit) instead of sizing pages from local CPU and memory
  (`utils/page-limiter.ts`). One render call may hold several sessions; shards (ADR 0005) map onto
  sessions naturally.
- **The limit is per target and per process.** Remote targets share one limiter per target for the
  whole process, and `sessions` bounds it, so concurrent shards do not multiply the cap.
- Connection-level failures (a dropped WebSocket, "no capacity", a session that never starts) are
  retried with backoff before the render pass sees them. Crash isolation (`capture/isolate.ts`) only
  ever sees a browser that died while rendering, so a provider outage is not treated as a story
  crash.

### 5. Reaching the Storybook: `exposeNetwork` first, signed URLs otherwise

- **Playwright `connect` providers that support it** (Azure Playwright Workspaces, a self-hosted
  Playwright server): pass `exposeNetwork: "<loopback>"`. The remote browser's requests for
  `127.0.0.1` are routed back through the connection to the host, so the static server works
  unchanged. Nothing new is exposed.
- **Everyone else** (CDP-only services, Puppeteer, providers that only offer a tunnel): the runner is
  given a **signed URL** to the build's published Storybook instead of the loopback server.

**Signed URL shape.** The token is a path prefix, because a Storybook loads `iframe.html` and then
many assets by relative path; a token on a single file URL would not reach them:

```
<publicOrigin>/s/<token>/projects/<slug>/storybook/build/<buildId>/iframe.html
```

The app strips the `/s/<token>` prefix, checks the token, and serves the build's static files
through the same file-serving branch as the build Storybook route (`app/src/routers/storybook.ts`,
`/projects/:slug/storybook/build/:buildId/*`) as if `canViewBuild` had passed. It never serves the
project and build wrapper page that route returns for an empty path.

**Token.** `base64url(projectId, buildId, expiresAt) + "." + HMAC-SHA256(key, same)`. It is verified
statelessly and grants read-only access to one build's static files and nothing else (no wrapper
page, no API, no other build).

- **Key.** Derived from `config.secret` with a fixed context string (`storyshelf/storybook-url/v1`),
  so a token can never be confused with a session or any other signature. Without a `secret`, every
  `reach: "url"` target is `unavailable: "no secret"`. During a rotation a token is also accepted if
  it verifies against `previousSecret`.
- **Expiry.** A per-job token with a default lifetime of 2 hours (`testing.storybookUrlTtl`, ADR
  0006). The render budget is per render call and crash isolation can make dozens of passes, so a
  lifetime tied to one budget would expire mid-render and show up as story failures; a fixed,
  generous bound is simpler and still short.
- **Where it applies.** The render request and the `extractParameters` input both carry
  `storybookUrl`.
- **Hygiene.** The token is redacted from logs, attempt records, and the error messages the runner
  surfaces.

Published Storybooks on `publishedBaseDomain` subdomains (ADR 0010, Projects, Published Storybook
and Labels) are not used for signed URLs: the app builds those links (`core/src/urls.ts`) but does
not serve those hosts itself, so whether a subdomain reaches this app depends on a proxy outside it.

### 6. The public origin is resolved from a chain, and learnt on first admin use

Anything that needs an absolute URL in the background (signed Storybook URLs, email links,
commit-status links) asks one resolver, which tries in order:

1. **Explicit configuration:** `config.publicBaseUrl`.
2. **Platform environment variables**, mapped by a `detectPublicBaseUrl(env)` helper in core next to
   `detectResources()`. Platforms that publish their own address include Heroku
   (`HEROKU_APP_DEFAULT_DOMAIN_NAME`, with the `runtime-dyno-metadata` Labs feature), Railway
   (`RAILWAY_PUBLIC_DOMAIN`, when the service has a domain), Vercel, Netlify, Render, Fly.io, Azure
   App Service, Azure Container Apps and DigitalOcean App Platform; the exact variables are pinned in
   the helper's tests. Cloud Run's URL is deterministic but not injected; AWS App Runner, Lambda
   function URLs and Cloudflare Workers expose none. These give the platform's own domain, which is
   a working fallback but the wrong link when a custom domain fronts the app.
3. **The origin an authenticated admin actually used.** The System page reports the browser's
   `location.origin` back to the app (a same-origin, CSRF-protected POST from the page's existing
   script layer), the app stores it, and the page shows it as "detected from your browser" for the
   admin to confirm or replace. The browser's view is used, not the server's: the app does no proxy
   normalization, so behind a TLS-terminating proxy `c.req.url` is the internal `http://host:port`.
   Background jobs, which run inside an app instance, read the stored value from the database. The
   value lives in a small `site_settings` key-value table (DDL in the three dialects and a
   `siteSettings` key in `Tables`) and is written only through a site-admin, CSRF-protected route.
   With authentication disabled there is no admin, so nothing is learnt and the origin must come
   from configuration or the platform.

**Nothing resolved does not stop the app.** Targets that need a URL (`reach: "url"`) are
`unavailable: "no public origin"` until one resolves, so a first deploy starts, an admin opens the
System page, and the targets become ready. Without a resolved origin, notification links that need
one are omitted.

The `Host` / `X-Forwarded-Host` of an arbitrary request is never used: a background job has none,
and both can be forged to plant attacker-controlled links in emails and commit statuses. Commit
status links (ADR 0014, Git Hosts and Notifications) are built absolute through the same resolver,
and `target_url` is omitted when no origin is known.

### 7. Local engines are declared and verified, and can be absent

Declaring an engine does not prove it is installed, so the runner checks. When it starts, each local
target is verified without launching anything: Playwright asks the browser type for its
`executablePath()` and checks that the file exists; Puppeteer checks its configured executable
(`puppeteer-core` ships no browser, so a Puppeteer runner with no `executablePath` has its local
targets `unavailable`). The result is part of the runner's metadata, per target, `ready` or
`unavailable` with a reason, and is shown on the System page ("firefox: declared, not installed").

- A project setting that names an unavailable target is refused when it is saved, with the reason.
- The existence check cannot see missing system libraries. A launch that fails anyway marks the
  target unavailable with the launch error, and the job fails at once with that error instead of
  being retried through crash isolation: a launch failure is not a story's fault.
- `chrome` is real Chrome. In Playwright, a bare `"chrome"` or `local("chrome", { channel: "chrome" })`
  launches with the `chrome` channel (it needs `playwright install chrome`); in Puppeteer it needs an
  `executablePath`, and a bare `"chrome"` without one fails when the runner is created.

With no local entries the host needs no browsers at all (`playwright-core` only, no
`playwright install`), which removes the browsers' memory and CPU, by far the largest part of a
capture host's load. It does not make the host idle. What still runs locally:

- **Diffing.** PNG decode, `pixelmatch` and overlay encode run in the diff worker pool on this host
  (ADR 0008, Image Diff Engines).
- **Parameter extraction.** `extractParameters` opens one page to read Storybook's resolved
  parameters before rendering (`runner-playwright/src/capture-runner.ts`); with no local engines it
  runs on the project's primary target (`browsers[0]`). Only the Playwright runner implements it.
- **Extraction and serving.** Unzipping the build to scratch and, for `exposeNetwork` targets,
  serving it to the remote browser over the connection.
- **Screenshot transfer.** Every PNG comes back over the WebSocket and is written to storage.

Legacy snapshot and baseline rows with no `browser` mean local `chromium`: that is what produced
them.

## API

### Operator: declaring what a runner offers

Playwright, local engines only (the common case):

```ts
import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";

createPlaywrightCaptureRunner({ browsers: ["chromium", "firefox", "webkit"] });
// omitted → ["chromium"]
```

The binaries are provisioned separately; `playwright-core` never downloads them:

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

createShelfApp({ database, storage, testing: { runner } });
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

There is deliberately one runner per server (see Alternatives).

### Project: choosing targets

The project's `browsers` setting is a list of **capture targets**:

```ts
type CaptureTarget = BrowserName | `${BrowserName}@${string}`;

// Settings → Capture, or the project update API:
//   { "browsers": ["chromium", "chromium@browserstack", "webkit@grid"] }
```

- The engine half is checked against `BROWSER_NAMES`, the name half against the runner's targets;
  `MAX_BROWSERS` (3) counts targets.
- Saving a target the runner does not offer, or that is `unavailable`, is rejected at save time with
  the list of targets it does offer.
- `snapshots.browser` and baseline keys are text, so a target needs no schema change; each target
  gets its own baselines (decision 3).
- `BrowserName` is the type of a rendering engine; everything that stores, compares or validates a
  project's engines uses `CaptureTarget`, with no aliases. `resolveBrowsers` returns targets; code
  that launches or connects splits a target into its engine and name with one helper
  (`parseTarget`).

### Contract between core and the runner

```ts
interface CaptureRunnerMetadata {
  // the first entry is the default target
  targets: readonly {
    target: CaptureTarget;
    reach: "loopback" | "url"; // how the browser reaches the Storybook (decision 5)
    status: "ready" | { unavailable: string }; // decision 7
  }[];
}

interface RenderRequest {
  target: CaptureTarget;
  storybookDir: string; // always: the extracted build on this host
  storybookUrl?: string; // set by core for `reach: "url"` targets: a signed, absolute URL
  // …other fields as in ADR 0004
}
```

For a `reach: "url"` target, core mints the token, resolves the public origin (decision 6) and puts
`storybookUrl` on the render request and on the `extractParameters` input; the runner navigates there
instead of to its loopback server. While no public origin resolves, or no `secret` is set, such a
target is `unavailable`: a settings save that names it is refused and a build of a project that
already does fails at once with that reason, so builds never fail one by one with an unexplained
error.

### Scaling out

There is no separate worker (ADR 0006): every app instance runs the same `testing` configuration, so
every instance has the same `browsers` list and validates project settings against the runner it
already holds. Rendering scales on the browser side, not by adding processes that need database
access.

- **Pools that differ are presets.** A Firefox and WebKit pool and a Chromium pool are two presets
  with their own endpoints (`firefox@pool-b`, `chromium@pool-a`). Each target maps to its endpoint, so
  no job routing is needed, and one job still renders all of a project's engines.
- **`sessions` is per app instance.** When several instances share one provider plan, the operator
  divides the provider's parallel-session limit among them. For a self-hosted farm the cap belongs at
  the farm (Browserless's `CONCURRENT` and `QUEUED`, or a proxy in front of a Playwright server). A
  shared limit across instances (session leases in the database) is not built; it is added only if
  over-provisioning when the app scales turns out to be a real problem. A provider refusing a session
  for capacity is retried with backoff (decision 4), so exceeding the limit costs time, not builds.
- **A target an instance does not offer cannot reach a job,** because instances share one
  configuration and a settings save for an unknown or unavailable target is refused (decision 7).
- **Self-hosted farm.** The official Playwright image running `playwright run-server`, pinned to the
  same version as `playwright-core`, or Browserless, with a token and a concurrency cap in front
  (ADR 0006). A clear error at connect time names both versions when client and server differ.

## Consequences

**Positive**

- Any connect-capable provider works through one code path and a preset; adding a provider is
  configuration, not a package.
- With `exposeNetwork`, remote capture needs no new public surface at all.
- Remote captures are never compared against local ones, and their fingerprint describes the
  machine that rendered them, so provider image changes are diffed, not waved through.
- The public origin is not a first-deploy chicken-and-egg problem, and email and commit-status links
  get a correct absolute origin even without remote browsers.

**Negative**

- **Breaking default.** The Playwright runner offers only Chromium unless told otherwise. A server
  whose projects use Firefox or WebKit stops offering them until the operator lists them in
  `browsers`; the System page and the save-time refusal make that visible, and the upgrade notes say
  it.
- Each screenshot crosses the internet: slower per page than a local browser, paid back only by
  parallelism the operator does not have to host.
- Provider browser builds move. The fingerprint catches it, but every move is a baseline migration on
  the default branch; pinning the browser version in the preset is the operator's job.
- The signed-URL route is a new way to read a private Storybook from outside. It is narrow (one
  build, static files, short expiry) and was written for review: the points to check are listed in
  the implementation notes (#228).
- The customer's Storybook, possibly unreleased UI, is rendered by a third party. Remote capture is
  opt-in per project.
- Playwright `connect` requires compatible client and server versions, which ties `playwright-core`
  upgrades to each provider's supported range.

## Alternatives considered

- **One package per provider** (`runner-browserstack`, …). Rejected: every provider would re-solve
  the same problems; the differences are an endpoint and its capabilities.
- **A tunnel binary** (BrowserStack Local, Sauce Connect) as the only way in. Kept as a preset option,
  not the default: it is an extra process per host, and signed URLs cover the same need without
  third-party software.
- **Public URL from the `Host` header.** Rejected: forgeable, and absent in background work.
- **A `remotes` object plus `local` and `defaultTarget` options.** Rejected for the single `browsers`
  list: operators also need to say which engines are available locally, the first entry already
  defines the default, and a list lets the runner reject duplicates that an object spread would hide.
- **Several runner types at once (`composeRunners`).** Rejected. The orchestrator renders one engine
  at a time per job, so there is no parallelism between runner types to gain; the real reason to mix
  (local plus several remote services) is already one runner with a `browsers` list; Puppeteer next
  to Playwright saves nothing, since Playwright's headless Chromium is also chrome-headless-shell; and
  rendering one engine with two runners lets browser version and fonts differ, which the fingerprint
  reads as a migration.
- **Per-engine worker pools.** Not needed: pools are presets with their own endpoints (see Scaling
  out). Routing jobs to pools would need engine-level jobs, against the sharding rule that keeps a
  story's engines in one shard so a newly enabled engine can bootstrap from its sibling (ADR 0005).
- **WebdriverIO as the remote runner.** Deferred: the right tool for real devices and real Safari,
  wrong as the default (sessions instead of pages, unpinned browser builds). A future ADR if device
  coverage is needed.

## Implementation notes

Landed so far: the runner `browsers` list with bare engines and `local()`, `CaptureTarget`, the
installed-engine check and the `chrome` fix (decisions 1, 3 and 7, #225), and the public-origin
resolver with `site_settings` (decision 6, #227); remote connect, presets, in-browser
fingerprints, session limits, retries and `exposeNetwork` (decisions 1 to 5, #226). Signed URLs
(decision 5, #228): `RunnerTarget.reach` is `"url"` for a remote target that cannot route back,
`offeredTargets` (`core/src/capture/targets.ts`) marks such targets `unavailable` until a `secret` and
a public origin exist, and core now mints the URL (see "Signed URLs" below). Choices the text left open:

- **Where the code is.** `defineRemote` and the `RemoteBrowser` shape live in core
  (`adapters/remote-browser.ts`) so both runners validate alike; the presets are in the runners'
  `./remote` subpaths (`remote`, `playwrightServer`, `azurePlaywright`, `browserstack`; `cdp` for
  Puppeteer). `sessions` defaults to 1 and `playwrightServer` defaults `exposeNetwork` to
  `"<loopback>"`. A `RemoteOptions` also takes `connectRetries` (3), `connectBackoffMs` (500) and
  `connectTimeoutMs` (30 000).
- **The fonts digest does not use `document.fonts.check`.** It answers `true` for a family that does
  not exist, so it cannot tell installed fonts from missing ones. The probe measures text in a canvas
  against the generic family it would fall back to, over a fixed list of 44 families, in a blank page.
- **A failed connect is `transient` or not.** A service that is down (refused, timed out, no
  capacity) fails the job at once but leaves the target offered; refused credentials and a version
  mismatch mark it `unavailable` like a failed local launch.
- **`storybookUrl` is the build's Storybook root**, with or without a trailing `/iframe.html`; the
  runner reduces either to the directory `iframe.html` is served under (`storybookBase`).
- **Spike results (a bare `playwright run-server`, 1.63).** No authentication: the `--path` is the only
  gate and a wrong path is refused at the handshake with `400`. `--max-clients` queues a connection over
  the cap instead of refusing it, so a full farm shows up as a connect timeout. A version mismatch is
  refused with `428` and a message naming both versions (major and minor). `exposeNetwork:
"<loopback>"` works against it, so a self-hosted server is a `reach: "loopback"` target.

- **Signed URLs (#228).** The URL core hands a runner is the directory root
  `<publicOrigin>/s/<token>/`, not the `.../projects/<slug>/storybook/build/<buildId>/iframe.html`
  shape sketched in decision 5: the token already names the project and the build, so a slug in the
  path is one more thing to check against it and nothing to gain. `GET /s/<token>/<file>` is its own
  route (`app/src/routers/signed-storybook.ts`), not a branch of the build route, and shares only
  `readPublishedFile` with it. Token payload `<projectId>:<buildId>:<expiresAtSeconds>`; the
  signature is checked in constant time before the payload is read; a token claiming more than 24 h
  (`MAX_STORYBOOK_URL_TTL`) is refused even when signed. `testing.storybookUrlTtl` is in seconds
  (60 to 86400, default 7200) and reaches a forked child through an environment variable. The route
  is classified `testing`: a hosting-only instance does not serve it. `previousSecret` verifies a
  token and never signs one. A token is minted when a render pass starts (and for the parameter
  pre-pass), never at enqueue time, so queued shards and retries are not handed a stale one. A render
  pass whose budget outlasts the lifetime (more than about 480 captures at the 15 s allowance, with
  the default two hours) fails its later pages with `404`s: raise `storybookUrlTtl`. Refusals are all
  one `404` with `Cache-Control: private, no-store`; the reason is in the debug log only. The token
  is scrubbed from the request log, the OTEL `url.full` attribute, attempt logs, failure text and the
  pino `err` serializer by `redactSecrets`. Not covered: the provider's own recordings (documented),
  and a runner that logs the URL itself. Rate limiting is not applied: a render makes thousands of
  asset requests, and a refused token costs one HMAC and no database read.

- **Which settings saves are checked.** A save refuses only targets the project does not already
  have, so an unrelated settings save never fails because an engine it already names went away; the
  build of such a project still fails at once (`assertSupportedBrowsers`).
- **A stored, unconfirmed origin is used.** The origin an admin's browser reported resolves at once
  (marked "unconfirmed" on the System page) so a first deploy learns its URL without a second step;
  confirming it only records that an admin looked. The first report wins, and a later visit through
  another domain never replaces it. A report must carry the browser's own `Origin` header, equal to
  the reported origin.
- **Interactive routes keep a last resort.** The OAuth redirect URI and the OIDC helper document
  fall back to the request's own origin when nothing resolves, because they are answered to a
  browser that is present; background links never do.
- **Platform variables.** `detectPublicBaseUrl` reads Heroku, Railway, Vercel, Netlify (with
  `NETLIFY=true`), Render, Fly.io, Azure App Service and Container Apps, and DigitalOcean (`APP_URL`
  with `DIGITALOCEAN_APP_ID`); the table is pinned in `utils/public-origin.test.ts`.

## Open questions

- ~~Whether Storybook 8, 9 and 10 static builds load every asset by relative path, so the path-prefix
  token reaches them all.~~ Settled (#228): the gated test `remote capture over a signed Storybook URL`
  (`runner-playwright/src/remote.integration.test.ts`) captures a build of each fixture (8, 9, 10)
  through a CDP browser that can only open `<origin>/s/<token>/iframe.html`, so every asset loaded by
  relative path under the token prefix.
- Which providers honour `exposeNetwork` beyond Azure and a self-hosted Playwright server. A self-hosted
  `run-server` does (tested); Azure is taken from its documentation; a provider not shown to support it
  is treated as `reach: "url"`, the safe default.
- ~~Whether a bare `playwright run-server` has built-in authentication or a concurrency cap.~~ Settled
  (see the spike results above): no authentication, and a cap that queues.
- Whether GitHub and GitLab treat `target_url` as optional when no public origin is known
  (unverified).
