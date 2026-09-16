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

Supply it to `createShelfApp({ capture, config: { scratchDir } })` — the router builds the orchestrator that loads the build, extracts the uploaded archive into `scratchDir`, discovers stories, calls `capture.render(...)`, and persists. `server` is the assembly point that hard-wires this renderer today (`storyshelf-server serve`, passing `--data-dir` as `scratchDir`). A future alternative (e.g. a remote runner offloading capture to a worker fleet) implements the same pure `CaptureRunner` interface from `@storyshelf/core/adapters/capture-runner` as its own package and is swapped in at the `serve` assembly site — the router, orchestrator, and pipeline never change.

## Browsers

This package depends on `playwright-core` only — it never downloads browsers. Provision Chromium once per machine (pinned to the client version):

```sh
npx -y playwright@1.63.0 install chromium
```

The Fly image installs browsers at build time (`playwright install --with-deps chromium`); CI and local runs use the same command.

## How it fits

Core's capture logic is browser-agnostic: the **orchestrator** (`@storyshelf/core/capture`) owns loading, extraction, discovery, and persistence, and delegates only the actual screenshotting to this package's `render(input) => RenderResult`. This package supplies the pure renderer and the ephemeral Storybook static server it needs. It is the only place that depends on `playwright-core` (never full `playwright` — browsers are provisioned separately, see above).

See `docs/architecture.md` for the capture workflow and `docs/testing.md` for the gated browser integration suite.