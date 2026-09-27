# ADR 0022: OpenTelemetry Observability

## Status

Accepted (2026-09-27)

## Context

ADR 0014 gave StoryShelf structured JSON logs with `reqId` correlation between
HTTP requests and background capture work, and named hosted observability
(Sentry, Datadog, OTEL collector, …) as opt-in pino transports. That covers
logs, but operators of larger deployments need distributed **traces** (follow
an upload through queue → extract → render → persist, across process
boundaries) and **metrics** (capture durations, queue outcomes, adapter
latencies) in their own backends (Tempo, Prometheus, Jaeger, Honeycomb).

Constraints:

- Self-hosted default must stay one `docker run` with zero external services:
  observability is strictly opt-in and zero-overhead when off.
- The capture pipeline runs outside the request scope (in-process queue or a
  separately-assembled remote worker), so traces must propagate explicitly.
- `core` is Deno/Bun-compatible on JSR; Deno ships built-in OTEL that bridges
  `npm:@opentelemetry/api` natively. The server itself is Node-only
  (`node:sqlite`, `@hono/node-server`, Playwright).
- Repo rules apply: single prod owner per third-party dep, frozen `core`
  exports map, hermetic default test suite, ~150-line one-concern modules.

## Decision

### 1. New package `@storyshelf/observability` (single OTEL owner)

All OTEL runtime deps live in exactly one package's `dependencies`, per the
repo rule: `@opentelemetry/api`, `sdk-node`, `exporter-trace-otlp-http`,
`exporter-metrics-otlp-http`, `resources`, `sdk-metrics`,
`semantic-conventions`, plus `@hono/otel` (HTTP middleware), `hono` (types),
and `drizzle-orm` (table names for span attributes). Test-only SDK pieces
(`sdk-trace-base`, `context-async-hooks`, `core`) live in its `devDependencies`.

### 2. `@hono/otel` for the HTTP layer, wrapped

`createHttpMiddleware()` wraps `httpInstrumentationMiddleware`: W3C
extraction, route-template span names (`GET /api/v1/projects/:id/builds`),
status attributes, and request-duration metrics come from the official
middleware; the wrapper adds `storyshelf.req_id` and `enduser.id` after
downstream handlers run (still inside the span, since `@hono/otel` finalizes
after `next()`). Hand-rolled middleware was rejected: no reason to reown
propagation and semantic conventions. `@hono/otel` depends only on
`@opentelemetry/api` + `semantic-conventions`, so it works unchanged under
Deno's native provider too.

### 3. Env-driven, default off

`initObservabilityFromEnv()` (in the node-only `./node` subpath — see §8)
starts the SDK only when `OTEL_EXPORTER_OTLP_ENDPOINT` (or explicit
`STORYSHELF_OTEL_ENABLED=true`) is set. Otherwise — and always under Deno or
`OTEL_SDK_DISABLED=true` — it returns an idempotent noop handle. Standard
`OTEL_*` variables win (`OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_HEADERS`,
`OTEL_TRACES_SAMPLER[_ARG]`); `STORYSHELF_OTEL_*` covers only StoryShelf
gaps (explicit on/off, metrics interval). No endpoint ⇒ no spans, no exports,
no behavioral change; the hermetic vitest suite stays network-free.

### 4. Core hosts the vocabulary, the package hosts the machinery

Mirroring the pino precedent (core owns the facade, backends live outside):

- `core` depends only on `@opentelemetry/api` (zero-dep shim, Deno-bridged)
  and uses it directly: internal `src/tracing.ts` (`withSpan`,
  `parentContext`, `injectTraceContext`, `currentTraceparent`), an
  `http.client` span with retry attributes in `httpJson` (query string
  redacted), and a `capture.job` root span with four phase children
  (`capture.extract`, `capture.persist-statics`, `capture.render`,
  `capture.persist`) in the orchestrator. No new `core` exports subpath —
  `tracing.ts` is intentionally internal (frozen-map rule).
- `@storyshelf/observability` owns the SDK lifecycle (`node.ts`: OTLP/HTTP
  trace + metric exporters, resource with service name/version/environment),
  `createInstrumentedDatabase`/`createInstrumentedStorage` wrappers
  (`db.*`/`storage.*` spans + duration histograms), the pino `otelLogMixin`
  (`trace_id`/`span_id`), meter instruments, and the Hono middleware.

### 5. No-cycle rule (load-bearing)

`core` must **never** import `@storyshelf/observability` (that would be a
workspace cycle and break JSR publishing). Consequences, all deliberate:

- The ~30 lines of `withSpan`/propagation helpers exist in **both** packages.
  Do not "deduplicate" them.
- `ShelfOptions.observability` is a **structural** handle
  (`{ shutdown(): Promise<void> }`) defined in `core/config.ts`, so core
  stays dependency-free while `app.lifecycle.teardown()` can flush the SDK.
- `CaptureJob`/`CaptureDispatchJob`/`CaptureJobInput` carry an optional
  `traceparent?: string` — pure data, no dependency.

### 6. Logs stay on stdout (explicit non-decision)

Traces and metrics export via OTLP/HTTP. Logs do **not** get an OTLP log
exporter: nothing bridges pino records into the OTEL `LoggerProvider`, and
adding a bridge dependency buys nothing while stdout JSON (now carrying
`trace_id`/`span_id` via the mixin, wired through the new
`LoggerOptions.mixin`) is already collector-forwardable. The collector tails
logs; OTEL carries traces/metrics. A pino→OTLP bridge is a recorded
follow-up, not a gap.

### 7. Metrics catalog (bounded cardinality)

`capture.job.duration` (histogram, ms), `capture.jobs.completed` /
`capture.jobs.failed` (counters), `db.operation.duration` (attrs
`db.operation`, `db.table`), `storage.operation.duration` (attr
`storage.operation` only — paths never enter metric attributes),
`http.server.*` (via `@hono/otel`). IDs, paths, and branch names never appear
in metric attributes. No per-story instruments (cardinality).

### 8. Deno split entrypoint

The package root (`@storyshelf/observability`) imports `@opentelemetry/api`
only and is cross-runtime. The SDK lifecycle lives in
`@storyshelf/observability/node` (Node-only; `deno: false` compat).
`initObservabilityFromEnv` detects Deno (`globalThis.Deno` / `OTEL_DENO`)
and returns the noop handle — Deno users set `OTEL_DENO=true` and their
`withSpan`/middleware calls light up via the native bridge with no SDK init.

### 9. Trace propagation across the queue boundary

`enqueueCapture` injects the active `traceparent` into the job payload;
SQS/Redis/Azure/GCP codecs carry it explicitly (serializers write it,
parsers thread it into `PollableJob`, requeue paths preserve it); the worker
passes it to `executeCaptureJob`, which continues the trace via
`parentContext`. The field is optional and `JSON.stringify` drops
`undefined`, so old messages and third-party queues interop. In-process
capture therefore nests `capture.job` under the uploading request's
`http.server` span end to end.

### 10. Naming (decided 2026-09-27, kept `observability`)

- Kept `@storyshelf/observability`: concern-over-protocol matches repo
  convention (top-level packages are concern nouns; nothing is named after a
  vendor/protocol), it covers all three signals, and it is the word operators
  expect in docs.
- Rejected `@storyshelf/otel`: accurate but protocol-named, breaking that
  convention.
- Rejected `@storyshelf/telemetry` despite being shorter and easier to spell:
  in self-hosted products "telemetry" connotes data leaving the deployment
  (phone-home usage stats to the vendor) — the opposite of this package's job
  (export to the *operator's own* collector) and corrosive to the
  your-data-stays-here promise. **The word `telemetry` is hereby reserved for
  a future opt-in anonymous usage-reporting feature**, where it is accurate.

### 11. Server wiring

`apps/dev-server`, `apps/fly-app`, and the `storyshelf server init` template
(plus the worker template) all emit the same preamble:
`initObservabilityFromEnv()` first, `createShelfLogger({ mixin:
otelLogMixin })`, then `createShelfApp({ logger, observability, … })`.
`app` mounts `createHttpMiddleware` after `requestId()`, serves
instrumented adapters on request/capture paths (lifecycle setup/health keep
raw adapters), and flushes the SDK in `lifecycle.teardown()`.

## Consequences

- Default behavior is byte-identical: no endpoint ⇒ noop providers, exact
  same queue payloads (conditional `traceparent` spread), same log lines
  minus trace fields.
- `nub run test` stays hermetic; OTEL tests use in-memory exporters.
- New JSR package (`sync` picks it up automatically); `nub.lock` gains the
  OTEL catalog entries (the `minimumReleaseAge` gate pinned `@hono/otel` to
  the mature 1.1.2 — do not bypass the gate for observability deps).
- Follow-ups (not gaps): pino→OTEL log bridge, affected-partition span,
  per-story render spans (rejected for now: cardinality), DB slow-query
  threshold logging with trace linkage.

## References

- ADR 0014 (Pino as Core Logger) — facade-in-core precedent, §4–5 transport
  model this ADR extends to OTEL.
- `docs/observability.md` — operator guide (env reference, span/metric
  catalogs, collector examples, troubleshooting).
