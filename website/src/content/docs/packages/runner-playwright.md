---
title: "@storyshelf/runner-playwright"
description: Playwright CaptureRunner — renders uploaded Storybook builds in-process for the StoryShelf server.
---

`@storyshelf/runner-playwright` is the default `CaptureRunner` implementation for StoryShelf. It unzips an uploaded Storybook build, serves the statics over a local HTTP server, launches Chromium, renders every story at each configured viewport, and stores the screenshots — driving the browser-agnostic `runCapture` pipeline from `@storyshelf/core`.

## Install

```sh
nub add @storyshelf/runner-playwright
```

## Usage

You normally never install this directly — `@storyshelf/server` injects it when you run `storyshelf-server serve`. Programmatically:

```ts
import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";

const capture = createPlaywrightCaptureRunner({ db, storage, dataDir, logger });
```

`logger` is an optional pino `Logger`; when provided, the runner derives a `logger.child({ buildId, reqId })` and passes it into the capture pipeline so per-build work is traced and correlated with the HTTP request that triggered it.

## How it fits

It is the only package that depends on `playwright`. Core's capture pipeline is browser-agnostic (injected `renderStory`), and the server is the assembly point where this runner (or a future alternative, e.g. a remote runner) is wired in behind the `CaptureRunner` interface.