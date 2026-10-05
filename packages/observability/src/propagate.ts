/**
 * W3C trace-context propagation helpers.
 *
 * Queue payloads carry the `traceparent` string (see `CaptureJob`) so a
 * remote worker can continue the enqueueing request's trace; outbound HTTP
 * injects the same header via {@link injectTraceContext}.
 */
import { context, propagation, type Context } from "@opentelemetry/api";

/** W3C traceparent header name. */
export const TRACEPARENT_HEADER = "traceparent";

/**
 * Resolve the parent context from an inbound `traceparent` value.
 *
 * @param traceparent - W3C value from a queue payload; undefined keeps context.
 * @returns The extracted remote context, or the active context when absent.
 */
export function parentContext(traceparent?: string): Context {
  if (!traceparent) {
    return context.active();
  }
  return propagation.extract(context.active(), { [TRACEPARENT_HEADER]: traceparent });
}

/** Inject the active span context into a mutable header record. */
export function injectTraceContext(headers: Record<string, string>): void {
  propagation.inject(context.active(), headers);
}

/**
 * Read the current W3C `traceparent` value for queue payloads.
 *
 * @returns The header value, or undefined when no span is active.
 */
export function currentTraceparent(): string | undefined {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier[TRACEPARENT_HEADER];
}
