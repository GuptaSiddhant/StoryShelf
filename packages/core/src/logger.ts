import pino from "pino";
import type { Logger } from "pino";

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
  /** Minimum level to emit. Defaults to `"info"`. */
  level?: string;
  /** Extra pino worker transports appended to the default stdout sink. */
  transports?: PinoTransport[];
  /** Deployment environment recorded in the `env` base field. Defaults to `NODE_ENV`. */
  env?: string;
}

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
 * The default sink is stdout. Hosted observability platforms (Sentry, PostHog,
 * Datadog, GCP, OTEL collector, etc.) are added as pino worker `transports` —
 * they are sinks for this logger, not standalone loggers.
 */
export function createShelfLogger(options: LoggerOptions = {}): Logger {
  const targets = [
    { target: "pino/file", options: { destination: 1 } },
    ...(options.transports ?? []),
  ];
  const transport = pino.transport({ targets });
  return pino(
    {
      level: options.level ?? "info",
      base: { env: options.env ?? process.env["NODE_ENV"] },
    },
    transport,
  );
}
