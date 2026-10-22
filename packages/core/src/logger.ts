import pino from "pino";
import type { Logger } from "pino";
import { redactSecrets } from "./utils/redact.ts";

/**
 * Create the structured JSON logger used across StoryShelf.
 *
 * Logging conventions:
 * - Always log structured objects, never interpolate into the message:
 *   `logger.info({ projectId, buildId }, "build started")`.
 * - Attach errors as an `err` child field rather than stringifying into the message:
 *   `logger.error({ err }, "capture failed")`.
 * - Derive scoped child loggers for background work:
 *   `const captureLogger = logger.child({ buildId })`.
 *
 * The default sink is stdout. The level resolves as explicit option, then
 * the `LOG_LEVEL` environment variable, then `"info"` — so `LOG_LEVEL=debug`
 * configures a default-constructed logger with no code changes. Unknown
 * levels throw at construction (fail fast on typos). Hosted observability
 * platforms (Sentry, PostHog, Datadog, GCP, OTEL collector, etc.) are added
 * as pino worker `transports` — they are sinks for this logger, not
 * standalone loggers.
 */
export function createShelfLogger(options: LoggerOptions = {}): Logger {
  const targets = [
    { target: "pino/file", options: { destination: 1 } },
    ...(options.transports ?? []),
  ];
  const transport = pino.transport({ targets });
  return pino(
    {
      level: options.level ?? process.env["LOG_LEVEL"] ?? "info",
      base: { env: options.env ?? process.env["NODE_ENV"] },
      mixin: options.mixin,
      serializers: { err: redactedError },
    },
    transport,
  );
}

/**
 * Pino's error serializer, with secrets scrubbed from the message and stack: a runner's error can
 * quote the signed Storybook URL it failed to open (ADR 0007, decision 5).
 */
function redactedError(err: unknown): unknown {
  const serialized: unknown = pino.stdSerializers.err(err as Error);
  if (serialized === null || typeof serialized !== "object") {
    return serialized;
  }
  const record = serialized as Record<string, unknown>;
  for (const key of ["message", "stack"]) {
    const value = record[key];
    if (typeof value === "string") {
      record[key] = redactSecrets(value);
    }
  }
  return record;
}

/** Pino logger type shared across StoryShelf. */
export type { Logger };

/** A pino worker transport to attach to the logger output. */
export interface PinoTransport {
  /** Package name or absolute path of the transport module. */
  target: string;
  /** Options passed to the transport worker. */
  options?: Record<string, unknown>;
}

/** Configuration for constructing the shelf logger. */
export interface LoggerOptions {
  /** Minimum level to emit. Defaults to `LOG_LEVEL` env, then `"info"`. */
  level?: string;
  /** Extra pino worker transports appended to the default stdout sink. */
  transports?: PinoTransport[];
  /** Deployment environment recorded in the `env` base field. Defaults to `NODE_ENV`. */
  env?: string;
  /**
   * Per-line mixin merged into every log record. Used for OTEL trace
   * correlation (`otelLogMixin` from `@storyshelf/observability`).
   */
  mixin?: () => Record<string, unknown>;
}
