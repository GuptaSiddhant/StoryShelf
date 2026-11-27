/**
 * StoryShelf observability: OTEL SDK lifecycle plus the runtime-agnostic helpers.
 *
 * The helpers (`withSpan`, the propagation helpers and the memoized instruments) live in
 * `@storyshelf/common/tracing` and are re-exported here. The
 * database and storage wrappers (`createInstrumentedDatabase`, `createInstrumentedStorage`) need core's
 * adapter types and stay in `@storyshelf/core/telemetry`; this package imports no core. The
 * Node SDK lifecycle (`initObservabilityFromEnv`) lives under `@storyshelf/observability/node`
 * and must never be imported here.
 */
export {
  captureMetrics,
  currentTraceparent,
  dbMetrics,
  injectTraceContext,
  parentContext,
  storageMetrics,
  TRACEPARENT_HEADER,
  withObservabilitySpan as withSpan,
} from "@storyshelf/common/tracing";
export type {
  CaptureInstruments,
  DbInstruments,
  HttpMiddlewareOptions,
  SpanAttributes,
  StorageInstruments,
} from "@storyshelf/common/tracing";
export { otelLogMixin } from "./logs.ts";
export { resolveObservabilityConfig } from "./config.ts";
export type { ObservabilityConfig } from "./config.ts";
export type { ObservabilityHandle } from "./types.ts";
