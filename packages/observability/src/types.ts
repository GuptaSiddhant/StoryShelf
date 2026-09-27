import type { Attributes } from "@opentelemetry/api";

/** Attributes attached to a span or metric measurement. */
export type SpanAttributes = Attributes;

/** Shutdown handle for the observability SDK (see `node.ts`). */
export interface ObservabilityHandle {
  /** Whether the SDK is active (false = noop: no endpoint configured or Deno runtime). */
  readonly enabled: boolean;
  /** Flush exporters and release SDK resources. Idempotent. */
  shutdown(): Promise<void>;
}

/** Options for the Hono HTTP middleware (`middleware.ts`). */
export interface HttpMiddlewareOptions {
  /** Service name in spans/metrics. Defaults to `OTEL_SERVICE_NAME` resolution. */
  serviceName?: string;
  /** Service version in spans/metrics. Defaults to the package version. */
  serviceVersion?: string;
}
