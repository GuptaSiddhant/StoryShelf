# @storyshelf/runner-playwright

A **pure** `CaptureRunner` implementation for StoryShelf: renders screenshots of Storybook stories **in-process** with Playwright. It serves an already-extracted Storybook directory over a local HTTP server, launches Chromium, renders every story at each configured viewport, and returns the screenshot buffers. It performs **no** database, storage, or build-state management — that is core's capture orchestrator's job (ADR 0015).

## Install

```sh
nub add @storyshelf/runner-playwright
```

## Usage

```ts
import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";

const capture = createPlaywrightCaptureRunner();
```

Supply it to `createShelfApp({ testing: { runner }, config: { scratchDir } })` — the router builds the orchestrator that loads the build, extracts the uploaded archive into `scratchDir`, discovers stories, calls `runner.render(...)`, and persists. `server` is the assembly point that hard-wires this renderer today (`storyshelf-server serve`, passing `--data-dir` as `scratchDir`). An alternative renderer (for example a remote browser) implements the same pure `CaptureRunner` interface from `@storyshelf/core/adapters/capture-runner` as its own package and is swapped in at the `serve` assembly site — the router, orchestrator, and pipeline never change.

The factory takes no dependencies. A pino `Logger` is an optional per-render input: the orchestrator derives a `logger.child({ buildId, reqId })` and passes it into each `render` call so per-build work is traced and correlated with the HTTP request that triggered it.

## Concurrency and memory

Each open Chromium page costs roughly 100–300 MB, so `render` captures a bounded number of story/viewport pairs at once instead of all of them. The default is sized from the detected CPU and memory (container limits included): the smaller of the CPU count rounded up, `(memory − 512 MB) / 300 MB`, and 4, never below 1. Override it with `createPlaywrightCaptureRunner({ concurrency })` or the `STORYSHELF_CAPTURE_CONCURRENCY` environment variable (the option wins). On a 0.5 vCPU or 1 vCPU host that means one page at a time, because extra pages only compete for the same CPU and trip timeouts. The per-page timeout scales the same way (30 s, 60 s under 2 CPUs, 90 s under 1 CPU); override it with `navigationTimeoutMs` or `STORYSHELF_NAVIGATION_TIMEOUT_MS`. The browser is restarted every 150 captures to bound its slow memory growth (`recycleBrowserEvery`, or `STORYSHELF_BROWSER_RECYCLE_EVERY`; `0` disables), and each render logs a `capture sizing` line with the detected CPUs, memory and resulting settings. When the orchestrator passes `onCapture`, each screenshot is handed over as soon as it is taken instead of being collected in the result, so memory does not grow with the story count. Set `reusePages: true` (or `STORYSHELF_REUSE_PAGES=1`) to reuse a pool of reset pages (own context each; storage, cookies and IndexedDB cleared between captures; failed pages discarded). It is off by default. Chromium is launched with low-memory flags (`--disable-dev-shm-usage` so small container `/dev/shm` mounts don't crash it, plus `--disable-extensions`, `--disable-background-networking`, `--mute-audio`). Flags that can change rendered pixels (`--disable-gpu`, `--single-process`) are deliberately left out so baselines stay stable.

Rule of thumb: total pages = `testing.concurrency` (builds at once, auto: 1 unless ≥ 2 CPUs and ≥ 3 GB) × runner `concurrency`.

## Browsers

`browsers` lists every target the runner offers, default first (ADR 0007). Omitted, it is `["chromium"]`: **Firefox and WebKit are offered only when you list them**, and a server whose projects use them stops offering them until you do.

```ts
import { createPlaywrightCaptureRunner, local } from "@storyshelf/runner-playwright";

createPlaywrightCaptureRunner({
  browsers: ["chromium", "firefox", "webkit", local("chrome", { channel: "chrome" })],
});
```

- An entry is a bare engine name, or `local(engine, { channel })` for a Playwright channel (`chrome`, `chrome-beta`, `msedge`, …; only `chromium` and `chrome` take one).
- The first entry is what a project with no `browsers` setting resolves to. A list that is empty, names an unknown engine or produces one target twice throws when the runner is created, not when the first build runs.
- Bare `"chrome"` is real Chrome: it launches with the `chrome` channel, so it needs `playwright install chrome`. It is no longer a fallback to bundled Chromium.
- `playwright-core` never downloads browsers. Provision them once per machine or image, pinned to the `playwright-core` version: `npx -y playwright@<version> install --with-deps chromium firefox webkit`.
- Declaring an engine does not prove it is installed. When the server starts, the runner checks each target without launching anything (the install marker next to Playwright's `executablePath()`, or the system Chrome for a channel), and reports it as `ready` or `unavailable` with a reason on **System → Capture browsers**. A launch that fails anyway marks its target unavailable and fails the job at once with the launch error, instead of being retried as a story crash.

## Remote browsers

An entry can also be a **remote service**, from the `/remote` subpath: the runner then connects to a browser on another machine instead of launching one, and offers `<engine>@<name>` targets (`chromium@grid`) with their own baselines.

```ts
import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";
import { azurePlaywright, playwrightServer } from "@storyshelf/runner-playwright/remote";

createPlaywrightCaptureRunner({
  browsers: [
    playwrightServer({ name: "grid", endpoint: "ws://playwright:3000/storyshelf", sessions: 8 }),
    azurePlaywright({
      endpoint: process.env.PLAYWRIGHT_SERVICE_URL!,
      token: process.env.PLAYWRIGHT_SERVICE_ACCESS_TOKEN!,
      sessions: 20,
    }),
  ],
});
```

- `playwrightServer`, `azurePlaywright`, `browserstack` and the generic `remote({ name, engines, protocol, reach, connect, sessions })` use `browserType.connect` (all three engines); `protocol: "cdp"` uses `chromium.connectOverCDP` (Chromium only, lower fidelity). Every preset is plain configuration: no vendor SDK is installed.
- `exposeNetwork: "<loopback>"` routes the remote browser's requests for the host's loopback Storybook server back through the connection (a self-hosted Playwright server, Azure). A service that cannot is a `reach: "url"` target and needs a signed Storybook URL.
- The target's environment (browser version, platform, device scale factor, fonts digest) is measured inside the browser, never from the host. Page concurrency is the service's `sessions`, shared per target across the process; connection failures are retried with backoff before the render sees them.
- With no local entry in `browsers` the host needs no installed browsers (only `playwright-core`).

See [Remote browsers](https://storyshelf.js.org/guides/remote-browsers/) for the farm guide, the presets and what bare `run-server` does and does not guard.

## How it fits

Core's capture logic is browser-agnostic: the **orchestrator** (`@storyshelf/core/capture`) owns loading, extraction, discovery, and persistence, and delegates only the actual screenshotting to this package's `render(input) => RenderResult`. This package supplies the pure renderer and the ephemeral Storybook static server it needs. It is the only place that depends on `playwright-core` (never full `playwright` — browsers are provisioned separately, see above).

See `docs/architecture.md` for the capture workflow and `docs/testing.md` for the gated browser integration suite.
