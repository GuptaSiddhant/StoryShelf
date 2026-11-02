/** OTEL wiring: idempotent integration registration and a local span helper. */
import { OpenTelemetry } from "@ai-sdk/otel";
import { SpanKind, SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api";
import { HttpError, redactSecrets } from "@storyshelf/core/utils";
import { registerTelemetry } from "ai";

let registered = false;

/** Register the SDK's OpenTelemetry integration once per process. */
export function registerOtelOnce(): void {
  if (registered) {
    return;
  }
  registered = true;
  registerTelemetry(new OpenTelemetry());
}

/** Test hook: forget the registration flag. */
export function resetOtelRegistrationForTests(): void {
  registered = false;
}

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

/**
 * Run `fn` inside an internal span (intentional copy of the core/observability
 * helper: ADR 0015 §5 no-cycle rule — do not deduplicate).
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Attributes,
): Promise<T> {
  const tracer = trace.getTracer("storyshelf.ai");
  return await tracer.startActiveSpan(
    name,
    { kind: SpanKind.INTERNAL, attributes },
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
