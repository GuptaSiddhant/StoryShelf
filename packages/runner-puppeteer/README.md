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

const runner = createPuppeteerCaptureRunner({
  // defaults to the test-bundled chrome-headless-shell; point at your own Chromium when needed
  executablePath: process.env.CHROME_PATH,
});
```

Hand the runner to the server:

```ts
import { createShelfApp } from "@storyshelf/app";
import { createPuppeteerCaptureRunner } from "@storyshelf/runner-puppeteer";

const app = createShelfApp({
  database,
  storage,
  testing: { runner: createPuppeteerCaptureRunner() },
});
```

## Browsers

`browsers` lists the targets the runner offers, default first (ADR 0007); omitted it is `["chromium"]`.

```ts
import { createPuppeteerCaptureRunner, local } from "@storyshelf/runner-puppeteer";

createPuppeteerCaptureRunner({
  executablePath: "/usr/bin/chromium", // what the bare "chromium" entry launches
  browsers: ["chromium", local("chrome", { executablePath: "/usr/bin/google-chrome" })],
});
```

`puppeteer-core` ships no browser, so a target is `ready` only when it has an executable that exists (the entry's own, the runner's `executablePath` for `chromium`, or `PUPPETEER_EXECUTABLE_PATH`); otherwise it is `unavailable` with that reason on **System → Capture browsers**. Bare `"chrome"` without its own `executablePath` throws when the runner is created, and `local("firefox")` and `local("webkit")` throw too: this runner drives Chromium-family engines only. A launch that fails marks its target unavailable and fails the job at once.

## Remote browsers

`cdp({ name, endpoint, headers, sessions })` from `@storyshelf/runner-puppeteer/remote` is a Chrome DevTools Protocol endpoint (Browserless, Cloudflare Browser Rendering, a Chrome with remote debugging). The runner calls `puppeteer.connect` and offers `chromium@<name>` (and `chrome@<name>` with `engines`):

```ts
import { createPuppeteerCaptureRunner } from "@storyshelf/runner-puppeteer";
import { cdp } from "@storyshelf/runner-puppeteer/remote";

createPuppeteerCaptureRunner({
  executablePath: "/usr/bin/chromium",
  browsers: [
    "chromium",
    cdp({
      name: "cloudflare",
      endpoint: "wss://…",
      headers: { authorization: `Bearer ${token}` },
      sessions: 4,
    }),
  ],
});
```

A Puppeteer remote browser cannot route back to the host, so every remote target needs a signed Storybook URL (`reach: "url"`); it stays `unavailable` until a `secret` and a confirmed public origin exist, then the server hands the runner a short-lived signed URL (`<public origin>/_s/<token>/`) for every render pass, and the runner refuses to start one without it. See [Signed Storybook URLs](https://storyshelf.js.org/guides/remote-browsers/#signed-storybook-urls). The target's environment is measured inside the browser, `sessions` is the per-target page cap shared across the process, and connection failures are retried with backoff. Details in [Remote browsers](https://storyshelf.js.org/guides/remote-browsers/).

## Concurrency and memory

Pages render through a bounded pool instead of all at once. The default is sized from the detected CPU and memory, container limits included (one page on 0.5–1 vCPU hosts, up to 4); override with `createPuppeteerCaptureRunner({ concurrency })` or `STORYSHELF_CAPTURE_CONCURRENCY`. The per-page timeout scales with CPU (30 s, 60 s under 2 CPUs, 90 s under 1 CPU); override with `navigationTimeoutMs` or `STORYSHELF_NAVIGATION_TIMEOUT_MS`. Every 150 captures the local browser is closed and relaunched to bound its slow memory growth (`recycleBrowserEvery`, or `STORYSHELF_BROWSER_RECYCLE_EVERY`; `0` disables). A connected remote target is instead disconnected and reconnected, never sent `Browser.close`, so sibling clients and the provider machine survive; a run closes only the pages and contexts it created and releases any provider lease once with the first outcome. Each render logs a `capture sizing` line with the detected CPUs, memory and resulting settings. When the orchestrator passes `onCapture`, each screenshot is handed over as soon as it is taken instead of being collected in the result, so memory does not grow with the story count. Set `reusePages: true` (or `STORYSHELF_REUSE_PAGES=1`) to reuse a pool of reset pages (own context each; storage, cookies and IndexedDB cleared between captures; failed pages discarded). It is off by default. The default launch args add low-memory flags (`--disable-dev-shm-usage`, `--disable-extensions`, `--disable-background-networking`, `--mute-audio`); passing your own `args` replaces them. See the deployment guide's "Sizing memory for capture" section.

See the [StoryShelf documentation](https://github.com/GuptaSiddhant/StoryShelf#readme) for configuration details.

## Puppeteer vs Playwright

| Aspect       | `runner-puppeteer`                                                                                 | `runner-playwright`                                 |
| ------------ | -------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Engine       | `puppeteer-core` + `chrome-headless-shell` (Chromium only)                                         | Playwright (`chromium`/`firefox`/`webkit`/`chrome`) |
| Selected via | `browsers` runner option (Chromium family only); projects pick from what it offers                 | `browsers` runner option; projects pick from it     |
| Image size   | Smaller — no bundled Firefox/WebKit                                                                | Larger                                              |
| Capabilities | Same orchestrator-owned controls: `play`, `delay`, `diffThreshold`, `viewports`, a11y (axe), burst | Identical controls                                  |

Both runners implement the same pure `CaptureRunner` contract. The orchestrator (`@storyshelf/core`, ADR 0015) owns build loading, archive extraction, story discovery, and persistence and delegates only the screenshotting to the runner, so switching is a one-line factory swap.

## License

MIT
