---
"@storyshelf/observability": minor
---

Breaking: @storyshelf/observability no longer exports createHttpMiddleware (the app owns it)

The app mounts its own copy from `packages/app/src/middleware/http-telemetry.ts`, and nothing else imported the observability one, so it is removed with observability's `hono` dependency. Schema: none.
