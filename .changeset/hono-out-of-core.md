---
"@storyshelf/core": patch
"@storyshelf/app": patch
"@storyshelf/observability": patch
---

Internal: keep Hono out of core; the HTTP telemetry middleware moves to the app (#1036)

`createHttpMiddleware` leaves `@storyshelf/core/telemetry` for `packages/app/src/middleware/http-telemetry.ts`, so core no longer imports `hono` or depends on `@hono/otel`. `@storyshelf/observability` exports its own copy again.
