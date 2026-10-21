# ADR 0015: Observability and Logging

## Status

Accepted

Supersedes (archived): ADR 0014, ADR 0022

## Context

StoryShelf needs structured logs for request-scoped and background work. Background work (the capture
pipeline, the retention purge) runs outside the Hono request scope, so request middleware alone cannot
cover it. Operators of larger deployments also need distributed traces (an upload followed through
queue, extract, render and persist) and metrics (capture durations, queue outcomes, adapter latency) in
their own backends (Tempo, Prometheus, Jaeger, Honeycomb).

Constraints:

- A self-hosted default stays one `docker run` with zero external services. Hosted observability is
  opt-in and zero-overhead when off.
- Hosted platforms (Sentry, PostHog, Datadog, Google Cloud Logging, OpenTelemetry collectors) are remote
  sinks, not primary loggers. The primary logger is local and zero-dependency.
- The capture pipeline runs outside the request scope, so trace context must propagate explicitly.
- `core` is Deno/Bun-compatible on JSR; Deno ships built-in OTEL that bridges `npm:@opentelemetry/api`.
  The server itself is Node-only.
- Repo rules apply: single prod owner per third-party dependency, frozen `core` exports map, hermetic
  default test suite, one-concern modules of about 150 lines.

## Decision

### 1. Pino is the core logger

`@storyshelf/core` depends on pino and exposes `createShelfLogger()` as the single logger factory
(default level `info`, structured JSON to stdout through a `pino/file` transport). There is no logger
adapter interface.

Conventions (also in `AGENTS.md`):

- Log structured objects, never interpolate into the message:
  `logger.info({ projectId, buildId }, "build started")`.
- Attach errors as an `err` child field: `logger.error({ err }, "capture failed")`.
- Derive scoped children for background work: `logger.child({ buildId })`.

### 2. One logger instance from the composition root

The server wiring calls `createShelfLogger()` once and passes the same `Logger` to the app, the capture
pipeline and the retention job through `ShelfOptions.logger` and constructor injection: one instance, one
JSON stream, request-scoped and background lines alike. `createShelfApp` falls back to
`createShelfLogger()` when none is supplied, so embedding without a server stays self-sufficient.
`ShelfOptions.logger` is also the override for tests, which pass `pino({ level: "silent" })` to keep the
hermetic suite free of pino worker transports.

Runtime loggers are host-owned: the host binds scoped children onto adapters through the optional
`Adapter.setLogger`. Adapter factories accept `options.logger` only as an explicit override and never
create their own loggers.

### 3. Hosted log sinks are transports on the factory

Sentry, PostHog, Datadog, Google Cloud Logging and similar sinks are pino worker transports passed to
`createShelfLogger({ transports })` at the composition root. They are not part of `ShelfConfig`: logger
construction options belong where the logger is built.

### 4. Request tracing in logs

Hono's `requestId` middleware assigns a per-request id and a native Hono logging middleware emits
structured `request start` / `request end` lines (method, path, status, duration). The build-create
handler threads the id as `reqId` through the capture job to the orchestrator, the renderer and
persistence, so background logs correlate with the request that triggered them. `pino-http` is not used:
it expects a Node server response and does not fit Hono's Web `Request`/`Response` model.

### 5. OpenTelemetry for traces and metrics: `@storyshelf/observability`

All OTEL runtime dependencies live in exactly one package, `@storyshelf/observability`:
`@opentelemetry/api`, `sdk-node`, the OTLP/HTTP trace and metric exporters, `resources`, `sdk-metrics`,
`semantic-conventions`, `@hono/otel`, `hono` (types) and `drizzle-orm` (table names for span
attributes). Test-only SDK pieces (`sdk-trace-base`, `context-async-hooks`, `core`) are dev dependencies.

### 6. HTTP layer: `@hono/otel`, wrapped

`createHttpMiddleware()` wraps `@hono/otel`'s `httpInstrumentationMiddleware`, which supplies W3C
extraction, route-template span names (`GET /api/v1/projects/:id/builds`), status attributes and
request-duration metrics. The wrapper adds `storyshelf.req_id` and `enduser.id` after downstream handlers
run, still inside the span. Hand-rolled middleware is rejected: there is no reason to re-own propagation
and semantic conventions. `@hono/otel` depends only on `@opentelemetry/api` and `semantic-conventions`,
so it works unchanged under Deno's native provider.

### 7. Env-driven, default off

`initObservabilityFromEnv()` (in the Node-only `./node` subpath, see decision 11) starts the SDK only
when `OTEL_EXPORTER_OTLP_ENDPOINT` is set or `STORYSHELF_OTEL_ENABLED=true`. Otherwise, and always under
Deno or `OTEL_SDK_DISABLED=true`, it returns an idempotent noop handle. Standard `OTEL_*` variables win
(`OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_TRACES_SAMPLER[_ARG]`); `STORYSHELF_OTEL_*`
covers only StoryShelf gaps (explicit on/off, metrics interval). With no endpoint there are no spans, no
exports and no behavioural change, and the hermetic vitest suite stays network-free.

### 8. Core hosts the vocabulary, the package hosts the machinery

- `core` depends only on `@opentelemetry/api` (a zero-dependency shim, Deno-bridged). It uses it
  directly through an internal `src/tracing.ts` (`withSpan`, `parentContext`, `injectTraceContext`,
  `currentTraceparent`), an `http.client` span with retry attributes in `httpJson` (query string
  redacted), and a `capture.job` root span with four phase children (`capture.extract`,
  `capture.persist-statics`, `capture.render`, `capture.persist`) in the orchestrator. `tracing.ts`
  is intentionally internal: no new `core` exports subpath.
- `@storyshelf/observability` owns the SDK lifecycle (`node.ts`: OTLP/HTTP exporters, a resource with
  service name, version and environment), the `createInstrumentedDatabase` and
  `createInstrumentedStorage` wrappers (`db.*` and `storage.*` spans plus duration histograms), the pino
  `otelLogMixin` (`trace_id`, `span_id`), the meter instruments and the Hono middleware.

### 9. No-cycle rule (load-bearing)

`core` never imports `@storyshelf/observability`: that would be a workspace cycle and break JSR
publishing. Consequences, all deliberate:

- The roughly 30 lines of `withSpan` and propagation helpers exist in both packages. They are not
  deduplicated.
- `ShelfOptions.observability` is a structural handle (`{ shutdown(): Promise<void> }`) defined in
  `core/config.ts`, so core stays dependency-free while `app.lifecycle.teardown()` can flush the SDK.
- Capture job types carry an optional `traceparent?: string`, which is plain data with no dependency.

### 10. Logs stay on stdout

Traces and metrics export over OTLP/HTTP. Logs do not get an OTLP exporter: stdout JSON already carries
`trace_id` and `span_id` through the mixin (`LoggerOptions.mixin`) and is collector-forwardable, so a
pino-to-OTEL bridge buys nothing today. The collector tails logs; OTEL carries traces and metrics.

### 11. Deno split entrypoint

The package root imports `@opentelemetry/api` only and is cross-runtime. The SDK lifecycle lives in
`@storyshelf/observability/node` (Node-only). `initObservabilityFromEnv` detects Deno (`globalThis.Deno`
or `OTEL_DENO`) and returns the noop handle; Deno users set `OTEL_DENO=true` and the `withSpan` and
middleware calls light up through the native bridge with no SDK init.

### 12. Metrics catalog (bounded cardinality)

`capture.job.duration` (histogram, ms), `capture.jobs.completed` and `capture.jobs.failed` (counters),
`db.operation.duration` (attributes `db.operation`, `db.table`), `storage.operation.duration` (attribute
`storage.operation` only; paths never enter metric attributes), and `http.server.*` from `@hono/otel`.
IDs, paths and branch names never appear in metric attributes, and there are no per-story instruments.

### 13. Trace propagation across the queue

Capture runs in the app, off a database-backed queue (see ADR 0006 Testing Option, Hosting-Only Mode and
the Database Queue). `enqueueCapture` injects the active `traceparent` into the job row, together with
the request id. The consumer passes it to `executeCaptureJob`, which continues the trace through
`parentContext`, so `capture.job` nests under the uploading request's `http.server` span end to end,
including when capture runs in a forked child of the app. The field is optional and old rows without it
are valid. There are no remote workers and no queue adapters to carry it.

### 14. Naming

The package is `@storyshelf/observability`: concern-over-protocol matches the repo convention (top-level
packages are concern nouns, none named after a vendor or protocol), it covers all three signals, and it
is the word operators expect. `@storyshelf/otel` is protocol-named and breaks that convention.
`@storyshelf/telemetry` is rejected because, in self-hosted products, "telemetry" connotes data leaving
the deployment, the opposite of this package's job (export to the operator's own collector). The word
`telemetry` is reserved for a possible future opt-in anonymous usage-reporting feature.

### 15. Server wiring

`apps/dev-server`, `apps/fly-app` and the `storyshelf server init` template emit the same preamble:
`initObservabilityFromEnv()` first, `createShelfLogger({ mixin: otelLogMixin })`, then
`createShelfApp({ logger, observability, ... })`. The app mounts `createHttpMiddleware` after
`requestId()`, serves instrumented adapters on request and capture paths (lifecycle setup and health keep
the raw adapters), and flushes the SDK in `lifecycle.teardown()`. Queue depth and oldest-job age are
exported as metrics so operators can autoscale on them.

## Consequences

- All logs are structured JSON through one pino pipeline; hosted observability is an opt-in transport or
  an opt-in OTEL endpoint, consistent with the zero-external-services default.
- With no endpoint the behaviour is byte-identical to a build without OTEL: noop providers, the same job
  rows apart from the optional `traceparent`, the same log lines minus trace fields.
- `nub run test` stays hermetic; OTEL tests use in-memory exporters.
- `core` depends on `pino` and `@opentelemetry/api`; `@storyshelf/observability` is a JSR package. The
  `minimumReleaseAge` gate applies to observability dependencies and is not bypassed.
- The OTEL consumer of AI calls (ADR 0016 AI Insights) follows the same single-owner and no-cycle rules.

## Follow-ups (not gaps)

A pino-to-OTEL log bridge, an affected-partition span, and slow-query logging with trace linkage. Per-story
render spans are rejected for cardinality.

## References

- `docs/observability.md`: operator guide (environment reference, span and metric catalogs, collector
  examples, troubleshooting).
