/**
 * Telemetry helpers over `@opentelemetry/api` only: spans, W3C propagation, memoized instruments,
 * and the database and storage wrappers (HTTP middleware lives in the app: core never imports Hono). Without an SDK registered every helper
 * is a cheap noop; `@storyshelf/observability` supplies the SDK and re-exports these.
 */
export { createInstrumentedDatabase } from "./instrument-db.ts";
export { createInstrumentedStorage } from "./instrument-storage.ts";
export { captureMetrics, dbMetrics, storageMetrics } from "./metrics.ts";
export type { CaptureInstruments, DbInstruments, StorageInstruments } from "./metrics.ts";
export {
  currentTraceparent,
  injectTraceContext,
  parentContext,
  TRACEPARENT_HEADER,
} from "./propagate.ts";
export { withSpan } from "./span.ts";
export type { HttpMiddlewareOptions, SpanAttributes } from "./types.ts";
