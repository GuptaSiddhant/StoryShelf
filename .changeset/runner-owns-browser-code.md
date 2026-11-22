---
"@storyshelf/core": minor
"@storyshelf/runner": minor
---

Breaking: all browser code moves from `@storyshelf/core` into `@storyshelf/runner`

Core no longer exports `defineRemote`, `isRemoteBrowser`, `hasSchemeFor`, `remoteTargetsOf`, `scrubConnection`, `connectLeased`, `shutdownRemote`, `onRemoteShutdown`, `RemoteConnectError`, `refCounted`, `logRemoteSizing`, `remoteSizingOf`, the `Remote*` types, `boundedProbe`, `inPageProbe`, `remoteEnvironment`, `FONT_PROBE_FAMILIES`, `retryConnect`, the session gate, the page limiter, `AdaptiveConcurrency`/`mapAdaptive`, or the a11y in-page functions, `resolveA11yRun` and `mapAxeViolations`. Import them from `@storyshelf/runner/remote` or `@storyshelf/runner/a11y`. `axeInjectionScript` and `loadAxeSource` move from the runner's root to `@storyshelf/runner/a11y`. Core keeps `CaptureRunner`, the capture-target parsers, `TargetLaunchError`, `CaptureEnvironment` and the a11y note readers. A test fails if core imports Playwright or launches a browser.

Schema: none
