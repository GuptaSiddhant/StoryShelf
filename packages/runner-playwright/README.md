# @storyshelf/runner-playwright

A `CaptureRunner` implementation for StoryShelf: renders uploaded Storybook builds **in-process** with Playwright. It unzips the uploaded build, serves the statics over a local HTTP server, launches Chromium, renders every story at each configured viewport, and stores the screenshots — driving `runCapture` from `@storyshelf/core`.

## Install

```sh
nub add @storyshelf/runner-playwright
```

## Usage

```ts
import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";

const capture = createPlaywrightCaptureRunner({ db, storage, dataDir });
```

`server` is the assembly point that hard-wires this runner today (`storyshelf-server serve`). A future alternative (e.g. a remote runner offloading capture to a worker fleet) implements the same `CaptureRunner` interface from `@storyshelf/core/adapters/capture-runner` as its own package and is swapped in at the `serve` assembly site — the router and pipeline never change.

## How it fits

Core's capture pipeline (`@storyshelf/core/capture`) is browser-agnostic and takes an injected `renderStory(story, viewport) => Buffer`. This package supplies that renderer plus the `CaptureRunner` shell and the ephemeral Storybook static server it needs. It is the only place that depends on `playwright`.

See `docs/architecture.md` for the capture workflow and `docs/testing.md` for the gated browser integration suite.