# @storyshelf/runner-puppeteer

Puppeteer capture runner for StoryShelf (Chromium via chrome-headless-shell), a smaller-image alternative to the Playwright runner.

## Install

```sh
nub add @storyshelf/runner-puppeteer
```

or

```sh
npm install @storyshelf/runner-puppeteer
```

## Usage

```ts
import { createPuppeteerCaptureRunner } from "@storyshelf/runner-puppeteer";

const capture = createPuppeteerCaptureRunner();
```

## Concurrency and memory

Pages render through a bounded pool instead of all at once. The default is sized from the detected CPU and memory, container limits included (one page on 0.5–1 vCPU hosts, up to 4); override with `createPuppeteerCaptureRunner({ concurrency })` or `STORYSHELF_CAPTURE_CONCURRENCY`. The per-page timeout scales with CPU (30 s, 60 s under 2 CPUs, 90 s under 1 CPU); override with `navigationTimeoutMs` or `STORYSHELF_NAVIGATION_TIMEOUT_MS`. The default launch args add low-memory flags (`--disable-dev-shm-usage`, `--disable-extensions`, `--disable-background-networking`, `--mute-audio`); passing your own `args` replaces them. See the deployment guide's "Sizing memory for capture" section.

See the [StoryShelf documentation](https://github.com/GuptaSiddhant/StoryShelf#readme) for configuration details.

## License

MIT
