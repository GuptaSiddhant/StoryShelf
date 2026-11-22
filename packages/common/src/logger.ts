/**
 * The logging surface the shared code needs. `@storyshelf/core`'s pino logger satisfies it, so
 * `common` stays free of pino: `createShelfLogger` and pino live in core.
 */

/** One log method: a structured object first, then the message (never string interpolation). */
export type LogMethod = (fields: object, message?: string) => void;

/** The part of a pino-style logger that outbound HTTP uses. */
export interface Logger {
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
}
