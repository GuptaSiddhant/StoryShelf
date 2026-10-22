# @storyshelf/observability

OpenTelemetry tracing, metrics, and log correlation for StoryShelf adapters. This is the single OTEL owner in the monorepo.

## Install

```sh
nub add @storyshelf/observability
```

or

```sh
npm install @storyshelf/observability
```

## Usage

```ts
import { createInstrumentedDatabase, createInstrumentedStorage } from "@storyshelf/observability";

const database = createInstrumentedDatabase(baseDatabase);
const storage = createInstrumentedStorage(baseStorage);
```

See the [StoryShelf documentation](https://github.com/GuptaSiddhant/StoryShelf#readme) for configuration details.

## Server wiring

```ts
import { otelLogMixin } from "@storyshelf/observability";
import { initObservabilityFromEnv } from "@storyshelf/observability/node";

// Noop unless OTEL_EXPORTER_OTLP_ENDPOINT is set. Call before createShelfApp.
const observability = await initObservabilityFromEnv();

const app = createShelfApp({
  database,
  storage,
  testing: { runner: captureRunner },
  logger: createShelfLogger({ mixin: otelLogMixin }),
  observability,
  config: { scratchDir: dataDir },
});

await app.lifecycle.setup();
// on SIGTERM: await app.lifecycle.teardown(); (flushes the SDK)
```

`storyshelf server init` scaffolds exactly this preamble. Two entrypoints by design: the root is `@opentelemetry/api`
only (cross-runtime, Deno-safe); `./node` holds the Node SDK lifecycle and
must never be imported under Deno (`OTEL_DENO=true` uses Deno's native OTEL
instead).

## What it exports

- `initObservabilityFromEnv`, `resolveObservabilityConfig` (`./node` / config) — env-driven SDK lifecycle.
- `createHttpMiddleware` — `@hono/otel` server spans plus `storyshelf.req_id` / `enduser.id` (mounted by `createShelfApp`).
- `createInstrumentedDatabase` / `createInstrumentedStorage` — transparent `db.*` / `storage.*` span + metric wrappers (identity, lifecycle, and tables delegate through).
- `withSpan`, `currentTraceparent`, `injectTraceContext`, `parentContext` — span and W3C propagation helpers.
- `captureMetrics`, `dbMetrics`, `storageMetrics` — memoized instruments (`capture.job.duration`, `capture.jobs.completed/failed`, operation durations).
- `otelLogMixin` — pino mixin injecting `trace_id`/`span_id` (logs stay on stdout; no OTLP log exporter by design).

Core (`@storyshelf/core`) uses `@opentelemetry/api` directly for pipeline
spans (`capture.job`, phase spans, `http.client`) and never imports this
package — that one-way boundary is load-bearing (see ADR 0022 §5).

## License

MIT
