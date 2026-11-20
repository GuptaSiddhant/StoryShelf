---
"@storyshelf/runner-puppeteer": patch
---

Changed: runner-puppeteer is deprecated and will be removed in 0.15.0; use runner-playwright

The runner logs one deprecation warning when the host binds its logger, and gets fixes only until removal. To switch:

1. Install `@storyshelf/runner-playwright`, run `playwright install chromium`, and remove `@storyshelf/runner-puppeteer`.
2. Replace `createPuppeteerCaptureRunner` with `createPlaywrightCaptureRunner`.
3. Map options: `executablePath` for Chrome becomes `local("chrome", { channel: "chrome" })`; other Chromium builds use `playwright install chromium`; `cdp({ name, endpoint, headers, sessions })` becomes `remote({ name, protocol: "cdp", reach: "url", sessions, connect: { endpoint, headers } })` from `@storyshelf/runner-playwright/remote`.
4. Expect one new baseline per project, because the capture fingerprint changes with the runner.
