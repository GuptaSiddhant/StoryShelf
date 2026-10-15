import type { Logger } from "pino";
import { emitAttemptLog, type AttemptLogRecorder } from "../models/capture-attempt.ts";
import type { CaptureLogLevel } from "../schema/capture-attempt.ts";

/** Longest error text recorded on an attempt-log line. */
const ERROR_TEXT_MAX = 500;

/** Mirrored levels; `debug` stays in pino only so attempt logs keep the signal. */
const MIRRORED_LEVELS = ["info", "warn", "error"] as const;

/** A logger that also records `info`/`warn`/`error` lines on the build attempt. */
export interface AttemptMirror {
  /** Logger to hand to a runner: same as the original, plus attempt-log recording. */
  logger: Logger;
  /** Record one line on the attempt (and in pino); serialized with the mirrored lines. */
  log(level: CaptureLogLevel, message: string, fields?: Record<string, unknown>): void;
  /** Wait for every recorded line to be written. */
  flush(): Promise<void>;
}

/**
 * Mirror a logger's `info`/`warn`/`error` lines onto the attempt log.
 *
 * Writes go through one promise chain: `capture_logs` numbers lines with a
 * read-then-insert, so concurrent appends (parallel pages failing at once)
 * would collide on `seq`. With no recorder the logger is returned unchanged.
 */
export function mirrorAttemptLog(
  logger: Logger | undefined,
  record: AttemptLogRecorder | undefined,
  /** Optionally re-level a recorded line (pino keeps the original level). */
  levelFor: (level: CaptureLogLevel, fields?: Record<string, unknown>) => CaptureLogLevel = (
    level,
  ) => level,
): AttemptMirror {
  let chain: Promise<void> = Promise.resolve();
  const enqueue = (level: CaptureLogLevel, message: string, fields?: unknown): void => {
    if (!record) return;
    const recorded = levelFor(level, fields as Record<string, unknown> | undefined);
    chain = chain.then(async () => {
      await emitAttemptLog(record, logger, recorded, message, fields);
    });
  };
  const base = logger ?? silentLogger();
  const mirrored = new Proxy(base, {
    get(target, property, receiver): unknown {
      const level = MIRRORED_LEVELS.find((name) => name === property);
      if (!level) return Reflect.get(target, property, receiver);
      return (first: unknown, second?: unknown, ...rest: unknown[]): void => {
        const args = [first, second, ...rest];
        while (args.length > 1 && args.at(-1) === undefined) args.pop();
        Reflect.apply(target[level], target, args);
        const [fields, message] = parseArgs(first, second);
        enqueue(level, message, fields);
      };
    },
  });
  return {
    logger: mirrored,
    log: (level, message, fields) => {
      base[level](fields ?? {}, message);
      enqueue(level, message, fields === undefined ? undefined : plainFields(fields));
    },
    flush: async () => {
      await chain;
    },
  };
}

/** pino call shapes: `(fields, message)` or `(message)`. */
function parseArgs(first: unknown, second: unknown): [Record<string, unknown> | undefined, string] {
  if (typeof first === "string") return [undefined, first];
  const fields = first && typeof first === "object" ? plainFields(first) : undefined;
  return [fields, typeof second === "string" ? second : ""];
}

/** JSON-safe copy: an `Error` under `err` becomes its capped message. */
function plainFields(fields: object): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...fields };
  const err = copy["err"];
  if (err instanceof Error) copy["err"] = err.message.slice(0, ERROR_TEXT_MAX);
  return copy;
}

function noop(): void {}

/** Stand-in when no logger was configured, so callers can log unconditionally. */
function silentLogger(): Logger {
  const stub: Record<string, unknown> = { info: noop, warn: noop, error: noop, debug: noop };
  stub["child"] = (): unknown => stub;
  return stub as unknown as Logger;
}
