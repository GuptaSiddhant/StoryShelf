/**
 * StoryShelf observability: OTEL SDK lifecycle plus the runtime-agnostic helpers.
 *
 * The helpers (`createInstrumentedDatabase`, `createInstrumentedStorage`, `createHttpMiddleware`,
 * `withSpan`, the propagation helpers and the memoized instruments) live in
 * `@storyshelf/core/telemetry` and are re-exported here, so this entrypoint's API is unchanged. The
 * Node SDK lifecycle (`initObservabilityFromEnv`) lives under `@storyshelf/observability/node`
 * and must never be imported here.
 */
export {
  captureMetrics,
  createHttpMiddleware,
  createInstrumentedDatabase,
  createInstrumentedStorage,
  currentTraceparent,
  dbMetrics,
  injectTraceContext,
  parentContext,
  storageMetrics,
  TRACEPARENT_HEADER,
  withSpan,
} from "@storyshelf/core/telemetry";
export type {
  CaptureInstruments,
  DbInstruments,
  HttpMiddlewareOptions,
  SpanAttributes,
  StorageInstruments,
} from "@storyshelf/core/telemetry";
export { otelLogMixin } from "./logs.ts";
export { resolveObservabilityConfig } from "./config.ts";
export type { ObservabilityConfig } from "./config.ts";
export type { ObservabilityHandle } from "./types.ts";
