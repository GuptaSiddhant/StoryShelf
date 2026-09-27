/**
 * Pino log correlation: inject the active trace context into every log line.
 *
 * Pass `otelLogMixin` as the pino `mixin` (see `LoggerOptions.mixin`) so
 * stdout JSON carries `trace_id`/`span_id` whenever a span is active. The
 * collector joins these with exported traces — this is the log signal
 * (no separate OTLP log exporter; pino stays the single log pipeline).
 */
import { context, trace } from "@opentelemetry/api";

/**
 * Build the trace-correlation fields for one log line.
 *
 * @returns `{ trace_id, span_id }` when a valid span is active, else `{}`.
 */
export function otelLogMixin(): Record<string, string> {
  const spanContext = trace.getSpan(context.active())?.spanContext();
  if (!spanContext || spanContext.traceId === "00000000000000000000000000000000") {
    return {};
  }
  return { trace_id: spanContext.traceId, span_id: spanContext.spanId };
}
