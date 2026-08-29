# ADR 0014: Pino as Core Logger

## Status

Accepted

## Context

StoryShelf needs a logging story. Background work (the capture pipeline, the retention purge job) runs **outside** the Hono request scope, so request-scoped middleware alone cannot cover it. An early `LoggerAdapter` interface existed but was only wired into the capture pipeline's single error call and defaulted to `console` in the router.

We considered several hosted options (Sentry, PostHog, Datadog, Google Cloud Logging, OpenTelemetry). Each of these is a **remote sink / observability backend**, not a primary logger — they consume structured log lines or errors rather than producing them. For a self-hosted product the primary logger must be local and zero-dependency by default, with hosted platforms as **optional transports** on top.

We evaluated whether to keep the `LoggerAdapter` abstraction and concluded we did not: a single pino logger baked into core gives us one canonical, well-typed structured-logging implementation with no interface indirection, while still allowing swap-out via a direct override.

## Decision

### 1. Pino is the core logger

`@storyshelf/core` depends on **pino** and exposes `createShelfLogger()` as the single logger factory (defaults to `info` level, structured JSON to stdout via a `pino/file` transport).

Logging conventions (see `AGENTS.md`):
- Always log structured objects; never interpolate into the message: `logger.info({ projectId, buildId }, "build started")`.
- Attach errors as an `err` child field: `logger.error({ err }, "capture failed")`.
- Derive scoped child loggers for background work: `logger.child({ buildId })`.

The `LoggerAdapter` interface is removed.

### 2. Composition root shares one instance

`createShelfRouter` keeps returning `Hono` unchanged; it falls back to `createShelfLogger()` internally if no logger is supplied, so embedding without a server stays self-sufficient. The standard server wiring calls `createShelfLogger()` once at the composition root (`serve.ts`) and passes the same `Logger` to the router, the capture runner, and the retention job via `ShelfOptions.logger` / constructor injection — one instance, one JSON stream, covering both request-scoped and background logs.

### 3. Override hook

`ShelfOptions.logger?: Logger` is kept as an override for unforeseen embedding cases and testing. Tests pass a `pino({ level: "silent" })` instance, keeping the hermetic vitest suite free of pino worker transports.

### 4. Transports via the factory, not ShelfConfig

Additional pino worker transports (Sentry, PostHog, Datadog, Google Cloud Logging, OTEL collector, etc.) are passed to `createShelfLogger({ transports })` at the composition root. They are **not** placed in `ShelfConfig` (runtime config) — logger construction options belong where they are used. `ShelfConfig` is unchanged.

### 5. Request tracing

Hono's `requestId` middleware assigns a per-request id, and a native Hono logging middleware emits structured `request start` / `request end` lines (method, path, status, duration). The build-create handler reads the request id and threads it as `reqId` through `enqueueCapture → Queue → capture runner → runCapture`, where it appears as a `reqId` field on background logs, correlating each capture back to the HTTP request that triggered it.

Note: `pino-http` was considered but rejected — it expects a Node server response (`res.on`), incompatible with Hono's Web `Request`/`Response` model (`app.request()` returns a standard `Response`).

## Consequences

- All StoryShelf logs are structured JSON through one pino pipeline.
- Hosted observability is an opt-in transport, not a separate logger — consistent with self-hosting's "one `docker run`, zero external services" default.
- `core` now depends on `pino` (and `runner-playwright` on `pino` for the type import).
