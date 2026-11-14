/**
 * W3C trace-context propagation helpers, over the implementations in `../tracing.ts`.
 *
 * Queue payloads carry the `traceparent` string (see `CaptureJob`) so the consumer can continue the
 * enqueueing request's trace; outbound HTTP injects the same header via `injectTraceContext`.
 */
export {
  currentTraceparent,
  injectTraceContext,
  parentContext,
  TRACEPARENT_HEADER,
} from "../tracing.ts";
