/**
 * Internal span and propagation helpers over `@opentelemetry/api`.
 *
 * Not exported from the package surface (see `package.json` exports): other
 * packages use `@storyshelf/observability`. Without a configured provider
 * every helper is a cheap noop, so call sites need no enabled-checks and
 * the hermetic vitest suite stays network-free.
 */
import {
  SpanKind,
  SpanStatusCode,
  context,
  propagation,
  trace,
  type Attributes,
  type Context,
  type Span,
} from "@opentelemetry/api";

/** Instrumentation scope for core spans. */
const SCOPE = "storyshelf.core";

/** W3C traceparent header name. */
const TRACEPARENT_HEADER = "traceparent";

/**
 * Run `fn` inside an internal span.
 *
 * On throw the span records the exception, is marked ERROR, and the error
 * is rethrown — mirroring the pino `{ err }` convention.
 *
 * @param name - Span name (`domain.operation`, never a high-cardinality value).
 * @param fn - Work to run with the span active.
 * @param attributes - Fixed span attributes.
 * @param parent - Parent context (defaults to the active context).
 * @returns Whatever `fn` returns.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Attributes,
  parent?: Context,
): Promise<T> {
  const tracer = trace.getTracer(SCOPE);
  return await tracer.startActiveSpan(
    name,
    { kind: SpanKind.INTERNAL, attributes },
    parent ?? context.active(),
    async (span) => {
      try {
        return await fn(span);
      } catch (error) {
        span.recordException(error instanceof Error ? error : String(error));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

/**
 * Resolve the parent context from an inbound `traceparent` value.
 *
 * @param traceparent - W3C value from a queue payload; absent keeps context.
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
