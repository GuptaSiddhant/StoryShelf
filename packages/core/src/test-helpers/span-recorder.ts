/**
 * An in-memory tracer for tests: records what `withSpan` and its callers put on spans (attributes,
 * exceptions, status) so a test can search all of it. Core has no OpenTelemetry SDK, and the
 * pieces `tracing.ts` uses are few enough to fake faithfully. Not exported from the package.
 */
import { trace, type Span, type Tracer } from "@opentelemetry/api";

/** What one span received. */
export interface RecordedSpan {
  name: string;
  attributes: Record<string, unknown>;
  exceptions: { name: string; message: string; stack: string }[];
  status: { code: number; message?: string } | undefined;
  ended: boolean;
}

/** Install the recorder as the global tracer provider; `stop` removes it. */
export function recordSpans(): { spans: RecordedSpan[]; stop: () => void } {
  const spans: RecordedSpan[] = [];
  const tracer = {
    startActiveSpan: (name: string, ...rest: unknown[]) => {
      const options = rest.length > 1 ? (rest[0] as { attributes?: Record<string, unknown> }) : {};
      const record: RecordedSpan = {
        name,
        attributes: { ...options.attributes },
        exceptions: [],
        status: undefined,
        ended: false,
      };
      spans.push(record);
      return (rest.at(-1) as (span: Span) => unknown)(spanOf(record));
    },
  } as unknown as Tracer;
  trace.disable();
  trace.setGlobalTracerProvider({ getTracer: () => tracer });
  return { spans, stop: () => trace.disable() };
}

function spanOf(record: RecordedSpan): Span {
  const span = {
    recordException: (exception: Error | string): void => {
      record.exceptions.push(
        typeof exception === "string"
          ? { name: "string", message: exception, stack: "" }
          : { name: exception.name, message: exception.message, stack: exception.stack ?? "" },
      );
    },
    setAttribute: (key: string, value: unknown): unknown => {
      record.attributes[key] = value;
      return span;
    },
    setStatus: (status: { code: number; message?: string }): unknown => {
      record.status = status;
      return span;
    },
    end: (): void => {
      record.ended = true;
    },
    isRecording: (): boolean => true,
    spanContext: () => ({ traceId: "0".repeat(32), spanId: "0".repeat(16), traceFlags: 0 }),
  };
  return span as unknown as Span;
}
