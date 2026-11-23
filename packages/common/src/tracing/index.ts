/**
 * Tracing helpers over `@opentelemetry/api` only: spans, W3C propagation, redacted exceptions and
 * the memoized instruments. Without an SDK registered every helper is a cheap noop;
 * `@storyshelf/observability` supplies the SDK.
 */
export { captureMetrics, dbMetrics, storageMetrics } from "./metrics.ts";
export type { CaptureInstruments, DbInstruments, StorageInstruments } from "./metrics.ts";
export { withObservabilitySpan } from "./observability-span.ts";
export {
  currentTraceparent,
  injectTraceContext,
  parentContext,
  setSpanMessage,
  spanException,
  TRACEPARENT_HEADER,
  withSpan,
} from "./tracing.ts";
export type { HttpMiddlewareOptions, SpanAttributes } from "./types.ts";
