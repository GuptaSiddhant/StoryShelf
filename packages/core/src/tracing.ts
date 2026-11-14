/**
 * Internal span and propagation helpers over `@opentelemetry/api`.
 *
 * Internal to core; the public surface is `@storyshelf/core/telemetry`, which re-exports the
 * propagation helpers. Without a configured provider every helper is a cheap noop, so call sites
 * need no enabled-checks and the hermetic vitest suite stays network-free.
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
import { redactSecrets } from "./utils/redact.ts";

/** Instrumentation scope for core spans. */
const SCOPE = "storyshelf.core";

/** W3C traceparent header name. */
export const TRACEPARENT_HEADER = "traceparent";

/** What a span records of an error instead of its message, set by the code that knows the error. */
const spanMessages = new WeakMap<object, string>();

/**
 * State what spans record as the message of `error`, instead of its own: an outbound HTTP failure
 * is recorded as its status, never the response body it carries. The error itself is not touched,
 * so what a caller catches is unchanged.
 */
export function setSpanMessage(error: unknown, message: string): void {
  if (typeof error === "object" && error !== null) {
    spanMessages.set(error, message);
  }
}

/**
 * The form of a failure that may be recorded on a span: a new error of the same name whose message
 * (the one given to {@link setSpanMessage}, else the error's own) has gone through
 * `redactSecrets`, with the original's stack frames. Never the original, whose message, stack
 * header or `cause` can repeat a URL, a token or a response body. A thrown non-error is stringified
 * and redacted. This is the one way core records an exception on a span.
 */
export function spanException(error: unknown): Error | string {
  if (!(error instanceof Error)) {
    return redactSecrets(String(error));
  }
  const message = redactSecrets(spanMessages.get(error) ?? error.message);
  const copy = new Error(message);
  copy.name = error.name;
  copy.stack = `${error.name}: ${message}${redactSecrets(framesOf(error))}`;
  return copy;
}

/** The stack after its `Name: message` header, which may hold what the span must not record. */
function framesOf(error: Error): string {
  const header = `${error.name}: ${error.message}`;
  return error.stack?.startsWith(header) ? error.stack.slice(header.length) : "";
}

/**
 * Run `fn` inside an internal span.
 *
 * On throw the span records a redacted copy of the exception ({@link spanException}), is marked
 * ERROR, and the original error is rethrown untouched — mirroring the pino `{ err }` convention.
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
        span.recordException(spanException(error));
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
