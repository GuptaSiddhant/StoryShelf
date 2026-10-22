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

Supply it to `createShelfApp({ testing: { runner }, config: { scratchDir } })` — the router builds the orchestrator that loads the build, extracts the uploaded archive into `scratchDir`, discovers stories, calls `runner.render(...)`, and persists. `server` is the assembly point that hard-wires this renderer today (`storyshelf-server serve`, passing `--data-dir` as `scratchDir`). A future alternative (e.g. a remote runner offloading capture to a worker fleet) implements the same pure `CaptureRunner` interface from `@storyshelf/core/adapters/capture-runner` as its own package and is swapped in at the `serve` assembly site — the router, orchestrator, and pipeline never change.

## Concurrency and memory

Each open Chromium page costs roughly 100–300 MB, so `render` captures a bounded number of story/viewport pairs at once instead of all of them. The default is sized from the detected CPU and memory (container limits included): the smaller of the CPU count rounded up, `(memory − 512 MB) / 300 MB`, and 4, never below 1. Override it with `createPlaywrightCaptureRunner({ concurrency })` or the `STORYSHELF_CAPTURE_CONCURRENCY` environment variable (the option wins). On a 0.5 vCPU or 1 vCPU host that means one page at a time, because extra pages only compete for the same CPU and trip timeouts. The per-page timeout scales the same way (30 s, 60 s under 2 CPUs, 90 s under 1 CPU); override it with `navigationTimeoutMs` or `STORYSHELF_NAVIGATION_TIMEOUT_MS`. The browser is restarted every 150 captures to bound its slow memory growth (`recycleBrowserEvery`, or `STORYSHELF_BROWSER_RECYCLE_EVERY`; `0` disables), and each render logs a `capture sizing` line with the detected CPUs, memory and resulting settings. When the orchestrator passes `onCapture`, each screenshot is handed over as soon as it is taken instead of being collected in the result, so memory does not grow with the story count. Set `reusePages: true` (or `STORYSHELF_REUSE_PAGES=1`) to reuse a pool of reset pages (own context each; storage, cookies and IndexedDB cleared between captures; failed pages discarded). It is off by default. Chromium is launched with low-memory flags (`--disable-dev-shm-usage` so small container `/dev/shm` mounts don't crash it, plus `--disable-extensions`, `--disable-background-networking`, `--mute-audio`). Flags that can change rendered pixels (`--disable-gpu`, `--single-process`) are deliberately left out so baselines stay stable.

Rule of thumb: total pages = `testing.concurrency` (builds at once, auto: 1 unless ≥ 2 CPUs and ≥ 3 GB) × runner `concurrency`.

## Browsers

This package depends on `playwright-core` only — it never downloads browsers. Provision Chromium once per machine (pinned to the client version):

```sh
npx -y playwright@1.63.0 install chromium
```

The Fly image installs browsers at build time (`playwright install --with-deps chromium`); CI and local runs use the same command.

## How it fits

Core's capture logic is browser-agnostic: the **orchestrator** (`@storyshelf/core/capture`) owns loading, extraction, discovery, and persistence, and delegates only the actual screenshotting to this package's `render(input) => RenderResult`. This package supplies the pure renderer and the ephemeral Storybook static server it needs. It is the only place that depends on `playwright-core` (never full `playwright` — browsers are provisioned separately, see above).

See `docs/architecture.md` for the capture workflow and `docs/testing.md` for the gated browser integration suite.
