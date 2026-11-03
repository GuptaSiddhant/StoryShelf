/**
 * Span helpers over `@opentelemetry/api` (runtime-agnostic). Without a configured provider these are cheap
 * noops, so call sites need no enabled-checks.
 */
import {
  SpanKind,
  SpanStatusCode,
  context,
  trace,
  type Attributes,
  type Context,
  type Span,
} from "@opentelemetry/api";
import { HttpError, redactSecrets } from "@storyshelf/core/utils";

/**
 * What a span records of a caught error: a copy with the same `name` and a `redactSecrets` message
 * (connection strings, tokens and keys stay out of exported spans), and for an `HttpError` its
 * status only, never the response body. The caller still gets the original error rethrown.
 * Intentional copy of core's `spanException` (ADR 0015 §5 no-cycle rule: do not deduplicate).
 */
function recordedError(error: unknown): Error | string {
  if (!(error instanceof Error)) {
    return redactSecrets(String(error));
  }
  const message =
    error instanceof HttpError ? `HTTP ${String(error.status)}` : redactSecrets(error.message);
  const copy = new Error(message);
  copy.name = error.name;
  const header = `${error.name}: ${error.message}`;
  const frames = error.stack?.startsWith(header) ? error.stack.slice(header.length) : "";
  copy.stack = `${error.name}: ${message}${redactSecrets(frames)}`;
  return copy;
}

/** Instrumentation scope for observability-package spans. */
const SCOPE = "storyshelf.observability";

/**
 * Run `fn` inside an internal span.
 *
 * On throw the span records the exception, is marked ERROR, and the error
 * is rethrown — mirroring the pino `{ err }` convention.
 *
 * @param name - Span name (`domain.operation`, never a high-cardinality value).
 * @param fn - Work to run with the span active.
 * @param attributes - Fixed span attributes (no high-cardinality values in names).
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
        span.recordException(recordedError(error));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
