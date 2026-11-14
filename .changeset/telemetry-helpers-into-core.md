---
"@storyshelf/core": minor
"@storyshelf/app": minor
"@storyshelf/observability": minor
---

Changed: the app no longer depends on observability; its telemetry helpers move into `@storyshelf/core/telemetry` (#879)

`withSpan`, the propagation helpers (`currentTraceparent`, `injectTraceContext`, `parentContext`), `captureMetrics`, `dbMetrics`, `storageMetrics`, `createInstrumentedDatabase`, `createInstrumentedStorage` and `createHttpMiddleware` now live in the new `@storyshelf/core/telemetry` subpath, which needs only `@opentelemetry/api` (and `@hono/otel` for the middleware). `@storyshelf/app` imports them from core, so installing the app no longer installs the OpenTelemetry Node SDK. `@storyshelf/observability` re-exports them unchanged and still owns the SDK lifecycle (`@storyshelf/observability/node`); install it only to export telemetry.
