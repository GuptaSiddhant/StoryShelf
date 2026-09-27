/**
 * Span helpers over `@opentelemetry/api` (runtime-agnostic: Node SDK or
 * Deno's native bridge). Without a configured provider these are cheap
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
        span.recordException(error instanceof Error ? error : String(error));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
