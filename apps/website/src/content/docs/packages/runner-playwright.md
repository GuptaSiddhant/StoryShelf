---
title: "@storyshelf/runner-playwright"
description: Pure Playwright CaptureRunner — renders Storybook screenshots in-process for the StoryShelf server.
---

`@storyshelf/runner-playwright` is the default **pure** `CaptureRunner` implementation for StoryShelf. It serves an already-extracted Storybook directory over a local HTTP server, launches Chromium, renders every story at each configured viewport, and returns the screenshot buffers. It performs **no** database, storage, or build-state management — core's capture orchestrator (ADR 0015) owns that.

## Install

```sh
nub add @storyshelf/runner-playwright
```

## Usage

You normally never install this directly — your server scaffold uses it via `storyshelf server init`. Programmatically:

```ts
import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";

const capture = createPlaywrightCaptureRunner();
```

Hand the pure renderer to `createShelfRouter({ capture, config: { scratchDir } })`; the router builds the orchestrator that loads the build, extracts the uploaded archive into `scratchDir`, discovers stories, calls `capture.render(...)`, and persists. The factory takes no dependencies. A pino `Logger` is an optional per-render input: the orchestrator derives a `logger.child({ buildId, reqId })` and passes it into each `render` call so per-build work is traced and correlated with the HTTP request that triggered it.

## Interaction testing

When the project's **Tests** setting has **Enable interaction tests (play)** checked, the runner executes each story's `play` function before the screenshot (with `playTimeoutMs`, default 10000, and per-story `delay` if set). A throwing `play` fails the story:

- **Blocking** (`!flaky`) → whole build `failed`, GitHub status `failure`.
- **Flaky** (`tags: ['flaky-test']` case-insensitive whole-story, or `parameters.flakyTest` in `chromatic`/`storyshelf` keys with `storyshelf` winning) → build stays `reviewing`/`approved`, UI shows a warning, GitHub posts `success` with a warning comment `⚠️ flaky story failed — not blocking`.
- **Disabled** (`parameters.disableSnapshot` or `tags: ['skip']`) → skip capture + play entirely.

Per-story `delay`, `diffThreshold`, and `pauseAnimationAtEnd` are also read from the same dual-key `parameters` (merged as `{...chromatic, ...storyshelf}`), with `stories.json` preferred over `index.json` plus a runtime `__STORYBOOK_PREVIEW__` fallback for Storybook 8. See **Interaction testing** guide.

## How it fits

It is the only package that depends on `playwright`. Core's capture logic is browser-agnostic: the **orchestrator** owns loading, extraction, discovery, and persistence and delegates only the screenshotting to this package's `render(input) => RenderResult`. The server is the assembly point where this renderer (or a future alternative, e.g. a remote runner) is wired in behind the pure `CaptureRunner` interface.