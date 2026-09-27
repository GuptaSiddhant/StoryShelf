/**
 * StoryShelf observability: runtime-agnostic OTEL instrumentation.
 *
 * This entrypoint is cross-runtime (`@opentelemetry/api` only — Node SDK or
 * Deno's native bridge supplies the provider). The Node SDK lifecycle
 * (`initObservabilityFromEnv`) lives under `@storyshelf/observability/node`
 * and must never be imported here.
 */
import { createInstrumentedDatabase } from "./instrument-db.ts";
import { createInstrumentedStorage } from "./instrument-storage.ts";
import { createHttpMiddleware } from "./middleware.ts";

/** Wrap a database adapter with `db.*` spans and metrics. */
export { createInstrumentedDatabase };
/** Wrap a storage adapter with `storage.*` spans and metrics. */
export { createInstrumentedStorage };
/** Hono middleware emitting one `http.server` span per request. */
export { createHttpMiddleware };
export { captureMetrics, dbMetrics, storageMetrics } from "./metrics.ts";
export type { CaptureInstruments, DbInstruments, StorageInstruments } from "./metrics.ts";
export { otelLogMixin } from "./logs.ts";
export {
  TRACEPARENT_HEADER,
  currentTraceparent,
  injectTraceContext,
  parentContext,
} from "./propagate.ts";
export { resolveObservabilityConfig } from "./config.ts";
export type { ObservabilityConfig } from "./config.ts";
export { withSpan } from "./tracing.ts";
export type { HttpMiddlewareOptions, ObservabilityHandle, SpanAttributes } from "./types.ts";
