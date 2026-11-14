# Capture

> Part of the [StoryShelf architecture spec](./README.md).

## Capture Pipeline (Server-Side Render)

The CLI does **not** run Playwright. It builds Storybook (or reuses an existing build), zips the static output, and uploads it. The server renders stories in its own pinned Playwright environment (the local runner, `runner-playwright`; `runner-puppeteer` is an alternative runner, and a project can also render on remote browser targets, below). This keeps rendering deterministic (server controls the browser version) without cloning the repository on the server.

```
CI machine / local dev                  StoryShelf server
---------------------
1. storyshelf upload
2. build Storybook (optional)
3. zip static build           ------->  4. store zip, create build (status=pending)
                                        5. enqueue capture (async, 202 returned)
                                        6. orchestrator: load build, extract zip, discover stories
                                        7. capture renderer: Playwright renders each story x viewport
                                        8. orchestrator: diff against baselines, persist snapshots
                                        9. orchestrator: update build/snapshot statuses
```

### Adapter Identity & Lifecycle

Every adapter extends the shared `Adapter<Extra>` base (`core/adapter/metadata`): mandatory `metadata: { name, version, description?, kind, category }` plus an optional `lifecycle` sub-object. `lifecycle` is all or nothing — an adapter either omits it or implements all three hooks (`setup`, `teardown`, `health`). `category` (`database | storage | capture-runner | capture-queue | design | notifier`) names the concern so metadata reads standalone; `kind` stays an open string (`sqlite`, `local`, `s3`, …) for third-party implementations. All hooks must be idempotent.

`createShelfApp` kicks every `lifecycle.setup` eagerly via `Promise.allSettled` and exposes `app.lifecycle { ready, setup(), teardown() }`: `await app.lifecycle.setup()` before serving for fail-fast startup (database migrations run here — there is no top-level `migrate()`), otherwise the first request gates on settlement (503 with per-adapter failures); `await app.lifecycle.teardown()` on `SIGTERM`/`SIGINT`.

### Health

Two-tier, both ungated by init: `GET /api/v1/health` is open liveness (`{ status: "ok", uptimeSecs, version }`, no adapter I/O — the Fly/Docker probe path); `POST /api/v1/health` is site-admin deep readiness (`{ status, adapters: [{ category, kind, name, state, latencyMs?, detail? }] }`, 200 or 503, error text sanitized).

### Capture Renderer (pure adapter)

Capture adapters are **pure renderers** (ADR 0004). They render screenshots from an already-extracted Storybook directory and return PNG buffers; they never touch the database, storage, or build status. A `CaptureRunner` implementation renders and returns the following (abbreviated: the full interface is `CaptureRunner` in `core/src/adapters/capture-runner.ts`, and `render` also takes `shardIndex`, `executePlay`, `playTimeoutMs`, `runA11y`, `target`, `storybookUrl` and `adapter`; the runner also offers `targets` and the optional `extractParameters` and `runTests`; `RenderedSnapshot` also carries `viewport`, `browser`, `durationMs` and `a11y`):

```typescript
interface RenderedSnapshot {
  story: StoryEntry; // echoed back from the render request
  viewportName: string;
  screenshot: Buffer; // PNG bytes
}

interface CaptureRunner {
  render(input: {
    buildId: string;
    runId?: string; // this call's cancel handle (a shard id); defaults to buildId
    storybookDir: string; // already-extracted Storybook root
    stories: StoryEntry[];
    viewports: Viewport[];
    logger?: Logger;
    onCapture?: (capture: RenderedSnapshot) => Promise<void>; // optional streaming hand-off
  }): Promise<RenderResult>; // { captures, failures }
  cancel(buildId: string, runId?: string): Promise<void>; // one run, or every run of the build
}
```

**Capture targets and what a runner offers (ADR 0007).** A project's `browsers`, a snapshot's `browser` and every baseline key hold a **capture target**: an engine (`chromium`) or `<engine>@<name>` for a remote browser, which has its own baselines and is never compared with a local render. A runner declares its targets in `metadata.targets` (`RunnerTarget`: `target`, `reach` `loopback | url`, `status` `ready | { unavailable: reason }`), default first. The runners take them from a `browsers` option (bare engine names and `local(engine, options)`, default `["chromium"]`) and verify each local target at startup without launching it (`createTargetOffers`, `core/src/adapters/capture-target-offers.ts`). `render` and `extractParameters` take `target`. The orchestrator refuses, at capture time, a target the runner does not offer or that is unavailable (`assertSupportedBrowsers`), and the app refuses it when a project setting is saved. `reach: "url"` targets (signed Storybook URLs) read as `unavailable` while there is no `secret` or public origin (`offeredTargets`, `core/src/capture/targets.ts`). A launch or connect failure is a `TargetLaunchError`: the job fails with its reason, never through crash isolation, and the target is marked unavailable unless the failure is `transient` (a remote service that is down).

**Remote browsers (ADR 0007, decisions 1 to 5).** A `browsers` entry can be a remote service (`RemoteBrowser`, `core/src/adapters/remote-browser.ts`: `defineRemote` validates the name, `sessions`, engines, the declared `protocol` and `reach` and a fixed `connect` object when the runner is created; `remoteTargetsOf` expands it to `<engine>@<name>` targets carrying the declared `reach`, `loopback` meaning Playwright's `exposeNetwork: "<loopback>"`. A function `connect` receives a context (`buildId`, `runId`, `shardIndex`, `purpose`, `attempt`, `signal`) and may return a `lease`; `release` runs once per lease, bounded by `timeouts.releaseMs`, and `shutdownRemote` releases what is still held when the runner shuts down. `refCounted` shares one resource between connections). The runners' `./remote` subpaths hold the presets: `remote`, `playwrightServer`, `azurePlaywright`, `browserstack` (runner-playwright; `browserType.connect(endpoint, { headers, exposeNetwork })`, or `chromium.connectOverCDP` for the `cdp` protocol) and `cdp` (runner-puppeteer; `puppeteer.connect`). Connecting goes through `retryConnect` (`core/src/utils/connect-retry.ts`: exponential backoff on connection-level errors only, before the render pass or crash isolation sees them) and surfaces a `TargetLaunchError` with the endpoint and credentials scrubbed (`scrubConnection`); a Playwright version mismatch names both versions. A remote render's `CaptureEnvironment` is measured in a blank page of the browser it drove (`inPageProbe`, `remoteEnvironment` in `core/src/utils/remote-environment.ts`: OS, device pixel ratio and a digest of the probe fonts found by canvas text measurement), never from the host. Page concurrency for a remote target is its `sessions` through one process-wide `SessionGate` per target (`session-gate.ts`, passed to `createPageLimiter` as `gate`), so concurrent shards share the cap. `render` and `extractParameters` take an optional `storybookUrl` (the build's Storybook at a URL the browser can reach); a `reach: "url"` target without one fails at once, and the loopback server is not started when it is given. Browser ownership is explicit in `runner-puppeteer/src/session.ts`: a launched browser is closed, while a connected one is never sent `Browser.close`; the run closes only its own pages/contexts, disconnects, and releases a provider lease once with the first outcome. Release is bounded/idempotent, and recycling a connected target reconnects instead of relaunching.

**Signed Storybook URLs (ADR 0007, decision 5).** `utils/storybook-token.ts` is the one owner of the token: the path prefix `/_s/` (`STORYBOOK_TOKEN_PREFIX`; the `/_/` short link is a different route), the token shape, signing, verification, the derived key and the lifetime rules; the auth gate, the route table, `redactSecrets` and every minted URL take the prefix from it. A token is `base64url("<projectId>:<buildId>:<expiresAtSeconds>:<purpose>") + "." + base64url(HMAC-SHA-256(key, that part))`; the purpose is `capture` or `read` (ADR 0051), and `key` is `HMAC(secret, <context>)` with its own context per purpose (`storyshelf/storybook-url/v1` for `capture`, `storyshelf/storybook-read/v1` for `read`), so a token of one purpose never verifies for the other; a token with no purpose, as older preview tokens were, is refused. The signature is compared in constant time before the payload is read, `secret` is a bare secret or the rotation pair (`credentialKeys`; only the current key signs), and a token claiming more than 24 hours (`MAX_STORYBOOK_URL_TTL`) is refused. `capture/storybook-urls.ts` (`storybookUrlSource(options, { build, project })`) mints `<publicOrigin>/_s/<token>/` for a target whose `RunnerTarget.reach` is `"url"` (never for any other) and returns `undefined` without a secret or an origin. The lifetime is `storybookUrlTtl`: the project's `storybook_url_ttl_seconds` (nullable, 1050 (`MIN_STORYBOOK_URL_TTL_OVERRIDE`, checked by `storybookUrlTtlOverrideError`) to 86400, set under Settings -> Capture or `PATCH` as `storybookUrlTtlSeconds`) when set, otherwise the pass's render budget (`renderBudgetMs(captures)`, so stories x viewports x engines at 15 s each, minimum 15 minutes) plus 5 minutes, clamped to 2 hours at least and 24 hours at most; each pass hands its budget to the source (`enrichStories` for `extractParameters`, `MatrixInput.storybookUrl` for every render pass, including shard passes through `matrixInputOf`), so a queued shard or a retry never holds an old token and there is no global option or child environment for it. A pass whose budget outlasts the token it would get is cut into slices of stories by `renderInSlices` (`capture/token-chunks.ts`, using `StorybookUrlSource.ttlSeconds`; smaller slices for legacy short overrides; each render timeout is capped to the token lifetime less the grace), each with its own freshly minted URL, so the 24 hour cap per token never ends a render. The app route `GET /_s/:token/*` (`routers/signed-storybook.ts`, classified `testing`, `capture` tokens only, exempt from the sign-in redirect in `authGate`) is rate limited per client IP before the token is looked at (`storybookUrlRateLimit`, alias `testing.storybookUrlRateLimit`, default 6000 a minute, shared with `/_r/`, a `429` for any token), verifies the token, loads the project and build it names and serves the file through the same code as the published Storybook routes: `routers/published-access.ts` (`publishedAccess`: signed token, or a build anyone may open, or a signed-in viewer; `publishedCorsHeaders`) decides, `routers/published-files.ts` (`publishedRelativePath`, `servePublishedFile`) decodes the path, reads through the manifest and sets headers. The empty path, directories, `.`/`..`/empty/NUL/backslash segments and every failure answer one identical `404`. Answers carry `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag` and `nosniff`. Published files answer `Access-Control-Allow-Origin: *` (never credentials) for a public build, an instance without sign-in and any signed URL; a signed-in viewer's private build answers without it. **Read grants (ADR 0051, decision 4).** `GET /_r/:token/*` (`routers/read-grants.ts`, class `hosting`, so it works without `testing`) serves one build's uploaded files to a browser that cannot send a cookie, a sandboxed frame on an opaque origin. The `read` token lives one hour at most (`STORYBOOK_READ_TTL`; a longer claim is refused even when signed), verifies against the current `secret` only (a rotation ends every grant; `previousSecret` is not tried), and is minted only by `redirectToReadGrant` and by `previewBaseOf`. Every answer is sandboxed (`Content-Security-Policy: sandbox allow-scripts allow-popups allow-forms`, never `allow-same-origin`), `private, no-store`, `no-referrer`, `noindex`, `nosniff`, `Access-Control-Allow-Origin: *` without credentials; every refusal is the one identical `404`; the root serves `index.html`. In `storybookHosting.mode: "sandboxed"` every uploaded file of the project path and the short links carries the same sandbox header (`sandboxHeaders` in `published-access.ts` decides, from the route family and the mode; `/_s/` never does), and a signed-in viewer of a private build is redirected (`302`, `no-store`, `no-referrer`, query kept) from the canonical path to `/_r/<token>/<rest>`, so renewal re-checks permission; the app-rendered landing and preparing pages are not uploaded content and keep the app's headers. In `trusted` mode (the default) the project path and short links are served as before. Session answers are `private, no-cache` with a content-hash `ETag` and a `304` on a match. The component page frames a private build through a one-hour read grant minted for the viewer (`routers/preview-base.ts`, needs a `secret`, not `testing`); the page script fetches a fresh root from `GET /api/v1/projects/:slug/builds/:buildId/preview-token` (`routers/preview-token.ts`, class `hosting`) every `PREVIEW_TOKEN_REFRESH` (40 minutes) and re-points the frame. The token is scrubbed from every sink by `redactSecrets` (the `/_s/<token>` and `/_r/<token>` patterns are built from the prefix constants): the request log, the OTEL `url.full` attribute (`core/src/telemetry/http-middleware.ts`), failure text, attempt logs and the pino `err` serializer.

**Streaming captures.** The orchestrator passes `onCapture`: a runner that supports it hands over each screenshot as soon as it is taken and omits it from `RenderResult.captures`. The orchestrator validates the PNG and writes it straight to storage (`capture/matrix.ts`), keeping only metadata marked `stored`, so memory holds the pages in flight instead of every screenshot of the build. Persisting then skips the write and diffs from storage as before. Runners that ignore `onCapture` keep returning buffers and take the original path. A rejected `onCapture` becomes a render failure for that story and viewport.

### Capture Orchestrator

Because renderers are pure, the server-side **orchestrator** owns everything else (`capture/orchestrator.ts`): it loads the build/project, marks the build `capturing`, extracts the uploaded archive to a scratch dir (capped by entry count and uncompressed bytes, with path-traversal protection), discovers stories, delegates rendering to the pure `CaptureRunner`, then persists snapshots/diffs/baselines (see `capture/pipeline.ts`) and finalizes the build. The orchestrator is wired into the queue by `createShelfApp` when `ShelfOptions.testing` is set (it holds `runner`, `queue`, `concurrency`, `workerEntry`, `shardSize`, `mode`, `compare` and `images`; absent means hosting only) and requires a `ShelfConfig.scratchDir`.

One local renderer in v1 — `@storyshelf/runner-playwright` (the server already has Playwright via the base image). The interface is kept thin so another renderer (for example a remote browser, ADR 0007) can plug in without changing the pipeline or orchestration: it implements the same pure `CaptureRunner` interface.

> The capture queue (`capture_jobs`) is described in [Capture queue](./capture-queue.md).

### Story Source Adapter

> Want to understand what happens _inside_ the Storybook StoryShelf captures — the iframe, the
> channel/postMessage protocol, `#storybook-root`, `play` functions, and the index files `discover()`
> reads? See [`storybook-internals.md`](../storybook-internals.md), a study guide mapping Storybook's
> internals to this interface and chapter 10 for what the capture pipeline could do next.

```typescript
interface StorySourceAdapter {
  name: string;
  discover(source: string): Promise<StoryEntry[]>;
  buildUrl(baseUrl: string, storyId: string): string;
  screenshotSelector?: string; // default: "#storybook-root"
  waitForReady?(page: Page): Promise<void>;
}

interface StoryEntry {
  id: string;
  title: string;
  name: string;
  importPath?: string;
  tags?: string[];
  type: "story" | "docs";
}
```

Only the Storybook adapter exists in v1. Ladle uses the same CSF format (one-day addition). Histoire uses a different format (v2, when stable).

### Capture Flow

```typescript
async function capture(buildId: string): Promise<void> {
  // 1. Unzip the uploaded Storybook build into storage
  const storybookDir = await extractStorybook(buildId);

  // 2. Serve it over HTTP (Storybook needs an origin to fetch JS/assets)
  const server = await serveStatic(storybookDir); // http://127.0.0.1:<port>

  // 3. Discover stories from index.json
  const stories = await storybookAdapter.discover(storybookDir);

  // 4. Launch Playwright
  const browser = await chromium.launch();

  // 5. For each story x viewport: render + screenshot
  for (const viewport of options.viewports) {
    for (const story of stories) {
      const page = await browser.newPage({ viewport });
      const url = storybookAdapter.buildUrl(server.origin, story.id);
      await page.goto(url);
      await storybookAdapter.waitForReady?.(page);
      const buffer = await page.locator("#storybook-root").screenshot({ animations: "disabled" });
      await storeScreenshot(buildId, story, viewport, buffer);
    }
  }

  // 6. Diff each screenshot against its baseline (see "Baseline Resolution")
  await runDiffs(buildId);
}
```

**Affected capture and `baselineSha`.** With `affectedOnly`, the CLI renders only the stories a change reaches since `baselineSha` and the rest are inherited from the baselines. `baselineSha` is the commit of the newest earlier build on the branch whose outcome reached the baselines (`BuildModel.newestComparableBuild`): today an `approved` build, with a planned `skipped` build (resolved to its source) joining the same rule. A build still being reviewed, or cancelled, failed or rejected, is passed over, because inheriting past it would show its unreviewed changes as unchanged. With no such build `baselineSha` is `null` and the first-build path (a full capture) applies.

Inheriting is also checked per baseline: a story is inherited only when its baseline's `source_build_id` is the comparison build or an older one (by `created_at`). A baseline promoted from a later build, for example by a per-snapshot approval while that build was still being reviewed, is rendered instead, so a revert to the comparison build's version is not hidden. A baseline with no recorded source (legacy rows) is still inherited.

### Deterministic Rendering

Rendering happens on the server against the user's uploaded static build, in a pinned browser:

1. **Pinned Playwright image** -- same browser version everywhere (`mcr.microsoft.com/playwright:<pinned>`)
2. **Disable animations** -- CSS injection: `* { animation: none !important; transition: none !important; }`
3. **Wait for network idle and for Storybook's render-finished event** -- `networkidle` on navigation, then the preview channel's `storyRendered`/`storyFinished` (ADR 0004, decision 9), falling back to `delay ?? 500` ms when the page never signals
4. **Freeze time** (optional) -- inject a fixed `Date` via `page.addInitScript`
5. **Embed fonts** (optional) -- ensure same font files in the capture image
