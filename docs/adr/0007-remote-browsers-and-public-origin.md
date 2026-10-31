# ADR 0007: Remote Browsers, Reachable Storybooks, and the Public Origin

## Status

Accepted.

Supersedes (archived): ADR 0033.

Companion to ADR 0006: there is one deployable and no separate worker, so remote browsers are how
rendering scales, and every app instance runs the same configuration.

## Context

Capture is server-side (ADR 0004): the runner extracts the uploaded Storybook, serves it from a
loopback static server and drives a browser. A host that launches every browser locally pays for
every browser and can only render the engines it can install.

Hosted browser services offer the same engines on other machines: Azure App Testing, BrowserStack,
LambdaTest, Browserless, Cloudflare Browser Rendering, AWS Bedrock AgentCore, or a self-hosted
`playwright run-server`. They expose a browser over a WebSocket, so a runner can drive one with the
calls it already makes. Four problems follow:

1. **Connecting:** a runner must connect to a browser elsewhere, not only launch one.
2. **Reachability:** the static server binds loopback, so a remote browser cannot reach the
   Storybook.
3. **Fingerprint:** `detectCaptureEnvironment` reads `platform` and `fc-list` fonts from the runner
   host. For a remote browser both describe the wrong machine, so a provider image change could pass
   without a diff and rewrite default-branch baselines.
4. **Local engines must be checked, not claimed:** advertising an engine that is not installed
   fails mid-capture and crash isolation then treats it as a story crash. `chrome` must mean Chrome,
   not bundled Chromium.

Providers that cannot tunnel need an absolute URL to the published Storybook, which needs the
deployment's public origin. Many platforms generate that URL, so an operator cannot always set
`PUBLIC_BASE_URL` before the first deploy.

## Decision

### 1. A runner declares everything it can render in one `browsers` list

`createPlaywrightCaptureRunner` and `createPuppeteerCaptureRunner` take `browsers`: every target the
runner offers, local and remote. An entry is:

- a bare engine, `"chromium"`: a local engine with the runner's defaults;
- `local(engine, options)`: a local engine with options (Playwright `channel`, Puppeteer
  `executablePath`);
- a **remote preset** (`playwrightServer`, `azurePlaywright`, `browserstack`, `cdp`, or generic
  `remote`), which expands to one or more targets.

The runner flattens the list and rejects duplicate targets, so two entries producing the same
target are visible rather than silently overwritten.

- **Default:** omitted, `browsers` is `["chromium"]`; Firefox and WebKit are offered only when
  provisioned and listed.
- **Primary target:** the first flattened target is the runner's default and what a project with no
  `browsers` setting resolves to.
- **Projects keep stored targets.** A project stores `browser` (default `'chromium'`) and optionally
  `browsers`. A project naming a target the runner does not offer fails its builds at once
  (`assertSupportedBrowsers`), and the System page lists it.
- **No local engines:** a list with no bare or `local()` entries needs no installed browsers
  (decision 7).
- **Remote mechanics:** Playwright uses `browserType.connect(endpoint, { headers, exposeNetwork })`
  for its own protocol, or `chromium.connectOverCDP` for Chromium-only services; Puppeteer uses
  `puppeteer.connect`. `connectOverCDP` is lower fidelity but safe because the target has its own
  baselines and fingerprint. Browser recycling opens a new session instead of relaunching; for a
  connected target that means release the old client and connect again, never `Browser.close`.
- **Ownership is explicit:** a browser the run launched is closed; a browser it connected to is
  never sent `Browser.close`. A connected run closes only the pages and contexts it created, drains
  them, disconnects its transport and releases a provider lease once with the first outcome
  (`finished`, `failed` or `cancelled`). Release is bounded and idempotent, so cancel/recycle races
  cannot double-release a lease or mask the render error.
- **Presets are plain configuration, not packages:** a function returning
  `{ name, protocol, endpoint, headers, exposeNetwork?, sessions, engines }`. A provider package is
  justified only for something a connect endpoint cannot do (real devices, real Safari).
- **`engines` picks a subset** of what a service offers; a Chromium-only service cannot offer
  Firefox and fails at runner creation.
- **Credentials are operator-level only**, like every adapter's; per-project provider accounts are a
  later step (ADR 0011).

### 2. A remote browser's environment is measured inside the browser

For a remote target the runner reports `CaptureEnvironment` from the browser it drove, never the
host:

- `browserVersion`: `browser.version()`.
- `platform`: the preset's requested OS, confirmed from the page (`navigator.userAgentData` /
  `navigator.platform`), never `process.platform`.
- `deviceScaleFactor`: `window.devicePixelRatio`.
- `fontsHash`: a digest computed in the page over a fixed font probe, never `fc-list`.

A field the runner cannot determine is omitted; an unknown fingerprint component is not a change
(ADR 0005), so omission cannot read as a migration.

### 3. Remote captures are their own engine, and a target's name is data

A remote target is `<engine>@<name>`, where `<name>` is the preset's `name` or fixed default
(`chromium@browserstack`). It gets its own baselines and never compares against a local render:
different hosts, fonts and GPU paths would turn comparison into noise or migrations. Moving local to
remote is an explicit new-engine bootstrap.

The name is stored in `snapshots.browser` and every baseline key, so it comes only from `name` or a
fixed default, never from the OS, browser version or endpoint. Renaming starts fresh baselines.

- Two entries of one preset need an explicit `name` on at least one; a collision fails at runner
  creation, naming both entries.
- A `name` is lowercase letters, digits and hyphens, starts alphanumeric, at most 32 characters,
  because it becomes part of a storage key and unique index.

### 4. Concurrency is counted in sessions, and session failures are retried

- A remote target's page limiter uses the preset's fixed `sessions` cap instead of CPU/memory
  sizing. One render call may hold several sessions; shards map onto sessions naturally.
- **The limit is per target and per process**, so concurrent shards do not multiply the cap.
- Connection-level failures (dropped WebSocket, no capacity, a session that never starts) are
  retried with backoff before the render pass sees them. Crash isolation only sees a browser that
  died while rendering, so a provider outage is not a story crash.

### 5. Reaching the Storybook: `exposeNetwork` first, signed URLs otherwise

- **Playwright `connect` providers that support it** (Azure, self-hosted Playwright server): pass
  `exposeNetwork: "<loopback>"`; the remote browser's `127.0.0.1` requests route back through the
  connection to the host, so the static server works unchanged.
- **Everyone else** (CDP-only, Puppeteer, tunnel-only providers): the runner gets a **signed URL** to
  the build's published Storybook.

**Shape.** The token is a path prefix because a Storybook loads `iframe.html` and assets by relative
path:

```
<publicOrigin>/_s/<token>/
```

The runner opens `iframe.html` under that root. The app strips `/_s/<token>`, checks the token and
serves the build's static files through the same handler and access rule as published Storybook
routes, with the token as the grant. It never serves the wrapper page for an empty path.

**Token:** `base64url(projectId, buildId, expiresAt) + "." + HMAC-SHA256(key, same)`, verified
statelessly; it grants read-only access to one build's static files and nothing else.

- **Key:** derived from `config.secret` with the fixed context `storyshelf/storybook-url/v1`, so it
  cannot be confused with a session or another signature. Without a secret every `reach: "url"`
  target is unavailable (`no secret`). During rotation `previousSecret` verifies but never signs.
- **Expiry:** minted when a render pass starts, lifetime from that pass's render budget plus a
  5-minute grace, floored at 2 hours and capped at 24 hours. A project may override
  `storybook_url_ttl_seconds` (`storybookUrlTtlOverrideError`, floor 1050 s, ceiling 86400); there is
  no instance option. A pass that would outlast its token is rendered in slices, each minting a
  fresh URL.
- **Where:** `render` and `extractParameters` inputs both carry `storybookUrl`.
- **Hygiene:** the token is redacted from logs, attempt records, errors, span attributes and
  `Referer`; refusals are one identical `404` with `Cache-Control: private, no-store`.

Published Storybooks on `publishedBaseDomain` subdomains are not used for signed URLs: the app
builds those links but does not serve those hosts, so reachability depends on an external proxy.

### 6. The public origin is resolved from a chain, and learnt on first admin use

Anything needing an absolute URL in the background (signed URLs, email links, commit-status links)
asks one resolver, which tries in order:

1. **Explicit configuration:** `config.publicBaseUrl`.
2. **Platform environment variables** via `detectPublicBaseUrl(env)`: Heroku, Railway, Vercel,
   Netlify, Render, Fly.io, Azure App Service/Container Apps, DigitalOcean. These give the
   platform's domain, a working fallback but the wrong link behind a custom domain. Cloud Run, App
   Runner, Lambda function URLs and Workers expose none.
3. **The origin an authenticated admin actually used.** The System page reports the browser's
   `location.origin` through a same-origin, CSRF-protected POST; the app stores it as
   **unconfirmed** and the page asks the admin to confirm or replace it. An unconfirmed origin is
   not resolved: no background link, notification or signed URL uses it. The browser's view is used
   because behind a TLS proxy `c.req.url` is the internal address. The value lives in
   `site_settings`, written only by a site-admin CSRF route. With auth disabled nothing is learnt;
   the origin must come from configuration or the platform.

**Nothing resolved does not stop the app.** `reach: "url"` targets are unavailable with
`no public origin` until a confirmed one resolves, so a first deploy starts, an admin confirms the
address and the targets become ready. Without an origin, notifications that need one are not sent
(ADR 0014, decision 11).

The `Host` / `X-Forwarded-Host` of an arbitrary request is never used: a background job has none,
and both can be forged to plant attacker-controlled links. Commit-status links use the same resolver;
without a confirmed origin no status is requested or delivered (ADR 0014, decision 11).

### 7. Local engines are declared and verified, and can be absent

Declaring an engine does not prove it is installed, so the runner checks at startup without
launching: Playwright asks for `executablePath()` and checks the file exists; Puppeteer checks its
configured executable (`puppeteer-core` ships none). The result is per-target metadata, `ready` or
`unavailable` with a reason, shown on the System page.

- A project setting naming an unavailable target is refused at save with the reason.
- The check cannot see missing system libraries. A launch that fails marks the target unavailable
  and fails the job at once with that error, not through crash isolation.
- `chrome` is real Chrome. Playwright uses the `chrome` channel (`playwright install chrome`);
  Puppeteer needs an `executablePath`, and a bare `"chrome"` without one fails at runner creation.

With no local entries the host needs no browsers (`playwright-core` only), removing the largest
capture-host load. Still local: diffing (ADR 0008), parameter extraction on the primary target,
unzip/static serving for `exposeNetwork`, and screenshot transfer.

Legacy snapshot and baseline rows with no `browser` mean local `chromium`.

## API

A runner declares targets once; presets are sugar over one generic constructor:

```ts
const runner = createPlaywrightCaptureRunner({
  browsers: [
    "chromium",
    local("chrome", { channel: "chrome" }),
    playwrightServer({
      name: "grid",
      endpoint: "ws://playwright:3000/",
      exposeNetwork: "<loopback>",
      sessions: 8,
    }),
    browserstack({
      username,
      accessKey,
      os: { name: "Windows", version: "11" },
      engines: ["chromium", "chrome"],
      sessions: 5,
    }),
  ],
});
```

A project's `browsers` is a list of capture targets (`BrowserName | <engine>@<name>`), capped at
`MAX_BROWSERS` (3). Saving a target the runner does not offer or that is unavailable is rejected at
save with the offered list. `snapshots.browser` and baseline keys are text, so no schema change is
needed; `resolveBrowsers` returns targets, and `parseTarget` splits engine and name.

For a `reach: "url"` target, core mints the token, resolves the origin and puts `storybookUrl` on
`render` and `extractParameters`; the runner navigates there instead of its loopback server. While
no confirmed origin or secret exists, the target is unavailable: a settings save naming it is
refused and a build of a project that already has it fails at once.

## Consequences

**Positive**

- Any connect-capable provider works through one code path and a preset; adding a provider is
  configuration, not a package.
- With `exposeNetwork`, remote capture needs no new public surface.
- Remote captures are never compared with local ones, and their fingerprint describes the rendering
  machine, so provider image changes are diffed, not waved through.
- The public origin is not a first-deploy chicken-and-egg problem; email and commit-status links get
  a correct absolute origin even without remote browsers.

**Negative**

- **Breaking default:** the Playwright runner offers only Chromium unless told otherwise. Servers
  using Firefox/WebKit stop offering them until the operator lists them; the System page and
  save-time refusal make it visible, and upgrade notes say it.
- Each screenshot crosses the internet: slower per page, paid back only by parallelism the operator
  does not host.
- Provider browser builds move. The fingerprint catches it, but every move is a default-branch
  migration; pinning is the operator's job.
- The signed-URL route is a new way to read a private Storybook from outside. It is narrow (one
  build, static files, short expiry) but security-sensitive.
- The customer's Storybook, possibly unreleased UI, is rendered by a third party. Remote capture is
  opt-in per project.
- Playwright `connect` needs compatible client/server versions, tying `playwright-core` upgrades to
  each provider's range.

## Alternatives considered

- **One package per provider.** Rejected: every provider re-solves the same problems; differences
  are an endpoint and capabilities.
- **A tunnel binary as the only way in.** Kept as a preset option, not the default: extra process
  per host, while signed URLs cover the same need.
- **Public URL from the `Host` header.** Rejected: forgeable and absent in background work.
- **A `remotes` object plus `local`/`defaultTarget` options.** Rejected for one `browsers` list:
  operators also declare local engines, the first entry defines the default, and a list exposes
  duplicate targets.
- **Several runner types at once.** Rejected: the orchestrator renders one engine at a time; mixing
  local and remote is already one runner with a list; two runners for one engine would let browser
  version/fonts differ, which the fingerprint reads as a migration.
- **Per-engine worker pools.** Not needed: pools are presets with endpoints; routing jobs to pools
  would break the rule that a story's engines stay in one shard (ADR 0005).
- **WebdriverIO as the remote runner.** Deferred: right for real devices/Safari, wrong as the
  default (sessions instead of pages, unpinned builds). A future ADR if device coverage is needed.

## Open questions

- Which providers honour `exposeNetwork` beyond Azure and self-hosted Playwright. A provider not
  shown to support it is treated as `reach: "url"`, the safe default.
- Whether a bare `playwright run-server` has authentication/concurrency limits. Spike: no
  authentication (`--path` is the only gate), and `--max-clients` queues rather than refuses.
- Whether GitHub/GitLab treat `target_url` as optional with no origin. Moot: with no confirmed
  origin no status is sent at all (ADR 0014, decision 11).
