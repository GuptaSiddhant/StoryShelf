/** OTEL wiring: idempotent integration registration and a local span helper. */
import { OpenTelemetry } from "@ai-sdk/otel";
import { SpanKind, SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api";
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
 * Run `fn` inside an internal span (intentional copy of the core/observability
 * helper: ADR 0022 §5 no-cycle rule — do not deduplicate).
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
        span.recordException(error instanceof Error ? error : String(error));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
