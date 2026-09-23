---
title: "@storyshelf/runner-puppeteer"
description: Lightweight Puppeteer CaptureRunner — Chromium-only screenshots with a smaller image.
---

`@storyshelf/runner-puppeteer` is a lightweight `CaptureRunner` that renders Storybook screenshots with Puppeteer (`puppeteer-core` + `chrome-headless-shell`). It produces Chromium-only captures at a smaller image size than the Playwright runner. Pair it with the `@storyshelf/worker` remote worker for a decomposed deploy or wire it directly into `createShelfApp`.

## Install

```sh
nub add @storyshelf/runner-puppeteer
```

[![JSR](https://jsr.io/badges/@storyshelf/runner-puppeteer)](https://jsr.io/@storyshelf/runner-puppeteer) [![JSR Score](https://jsr.io/badges/@storyshelf/runner-puppeteer/score)](https://jsr.io/@storyshelf/runner-puppeteer)

- [npm package](https://www.npmjs.com/package/@storyshelf/runner-puppeteer) — install tarballs and version history.
- [JSR package](https://jsr.io/@storyshelf/runner-puppeteer) — TypeScript-first registry page.
- [Public API reference](https://jsr.io/@storyshelf/runner-puppeteer/doc) — generated docs for every export; start here to learn the API.
- [Source on GitHub](https://github.com/GuptaSiddhant/storyshelf/tree/main/packages/runner-puppeteer) — package directory on `main`.

## Usage

```ts
import { createPuppeteerCaptureRunner } from "@storyshelf/runner-puppeteer";

const runner = createPuppeteerCaptureRunner({
  // defaults to the test-bundled chrome-headless-shell; point at your own Chromium when needed
  executablePath: process.env.CHROME_PATH,
});
```

Hand the runner to the server or to a remote worker — both are runners-agnostic:

```ts
import { createShelfApp } from "@storyshelf/app";
import { createPuppeteerCaptureRunner } from "@storyshelf/runner-puppeteer";

const app = createShelfApp({
  database, storage,
  capture: createPuppeteerCaptureRunner(),
});
```

```ts
import { createCaptureWorker } from "@storyshelf/worker";
import { createPuppeteerCaptureRunner } from "@storyshelf/runner-puppeteer";

const worker = createCaptureWorker({
  queue, db, storage,
  runner: createPuppeteerCaptureRunner(),
  scratchDir: "/tmp/shelf",
});
```

## Puppeteer vs Playwright

| Aspect | `runner-puppeteer` | `runner-playwright` |
|---|---|---|
| Engine | `puppeteer-core` + `chrome-headless-shell` (Chromium only) | Playwright (`chromium`/`firefox`/`webkit`/`chrome`) |
| Selected via | `browser` kept as `chromium`/`chrome` only (other names rejected at the project layer) | Any `browser` value, per-project |
| Image size | Smaller — no bundled Firefox/WebKit | Larger |
| Capabilities | Same orchestrator-owned controls: `play`, `delay`, `diffThreshold`, `viewports`, a11y, burst | Identical controls |

Both runners implement the same pure `CaptureRunner` contract. The orchestrator (`@storyshelf/core`, ADR 0015) owns build loading, archive extraction, story discovery, and persistence and delegates only the screenshotting to the runner, so switching is a one-line factory swap.

## When to use it

Choose Puppeteer when image size or cold-start time dominates — single-browser deploys, Fly/Railway/Lambda workers, or CI images where you already ship a system Chromium. Choose Playwright when you need Firefox, WebKit, or Chrome channel selection per project.
