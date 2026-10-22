/** Resolves `ShelfOptions` once at boot: validates `testing.compare` and fills the scratch default. */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { notificationsConfigSchema, type ShelfOptions } from "./config.ts";

/** Where capture scratch lives when `config.scratchDir` is not set. */
export const DEFAULT_SCRATCH_DIR: string = join(tmpdir(), "storyshelf");

/**
 * Validate and complete the options.
 *
 * - `testing.compare.threads` must be a non-negative integer.
 * - `notifications.config` must match its schema (it used to live in `ShelfConfig`, which validated it).
 * - `config.scratchDir` defaults to {@link DEFAULT_SCRATCH_DIR}: publishing extracts zips there,
 *   with or without `testing`.
 */
export function resolveShelfOptions(options: ShelfOptions): ShelfOptions {
  assertThreads(options.testing?.compare?.threads);
  assertTestingProcess(options.testing);
  assertTestingBackable(options);
  assertNotificationsConfig(options.notifications?.config);
  if (options.config?.scratchDir !== undefined) {
    return options;
  }
  return { ...options, config: { ...options.config, scratchDir: DEFAULT_SCRATCH_DIR } };
}

/**
 * A `testing` instance that renders here needs a database a long-running server can keep. An
 * instance that only hands jobs to a remote `testing.queue` renders nowhere in this process, so
 * it is left alone (the one deployment shape the earlier `capture` option supported on Workers).
 */
function assertTestingBackable(options: ShelfOptions): void {
  if (options.testing?.runner === undefined) {
    return;
  }
  if (options.database.metadata.supportsTesting === false) {
    throw new Error(
      `The ${options.database.metadata.name} database cannot back testing: it is reachable only ` +
        `from a platform that ends the process after each request, so nothing would run capture ` +
        `jobs. Remove the testing option to host Storybooks only, or use a network database ` +
        `(Turso, Postgres, MySQL, SQLite on a volume).`,
    );
  }
}

function assertTestingProcess(testing: ShelfOptions["testing"]): void {
  if (testing !== undefined && testing.runner === undefined && testing.queue === undefined) {
    throw new Error(
      "testing requires testing.runner (or testing.queue to replace the database queue)",
    );
  }
  if (testing?.workerEntry !== undefined && testing.runner === undefined) {
    throw new Error("testing.workerEntry requires testing.runner (it is the in-process fallback)");
  }
  if (testing?.mode === "fork" && testing.workerEntry === undefined) {
    throw new Error('testing.mode "fork" requires testing.workerEntry');
  }
  assertShardSize(testing);
  assertTestingNumbers(testing);
}

/** Numeric `testing` options: concurrency, retries and the Storybook URL rate limit. */
function assertTestingNumbers(testing: ShelfOptions["testing"]): void {
  assertConcurrency(testing?.concurrency);
  assertRetries(testing?.retries);
  assertLeaseSeconds(testing?.leaseSeconds);
  assertStorybookUrlRateLimit(testing?.storybookUrlRateLimit);
}

/** A whole number of requests per minute; `0` would refuse every render. */
function assertStorybookUrlRateLimit(limit: number | undefined): void {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error(
      `testing.storybookUrlRateLimit must be a positive whole number of requests per minute, got ${String(limit)}`,
    );
  }
}

/** Retries are counted after the first attempt: `0` runs a job once. */
function assertRetries(retries: number | undefined): void {
  if (retries !== undefined && (!Number.isInteger(retries) || retries < 0)) {
    throw new Error(`testing.retries must be a non-negative integer, got ${String(retries)}`);
  }
}

/** A lease must be a positive length: `0` would expire every job at once. */
function assertLeaseSeconds(seconds: number | undefined): void {
  if (seconds !== undefined && (!Number.isFinite(seconds) || seconds <= 0)) {
    throw new Error(
      `testing.leaseSeconds must be a positive number of seconds, got ${String(seconds)}`,
    );
  }
}

/** `0` would deadlock the consumer. */
function assertConcurrency(concurrency: number | undefined): void {
  if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency < 1)) {
    throw new Error(`testing.concurrency must be a positive integer, got ${String(concurrency)}`);
  }
}

function assertShardSize(testing: ShelfOptions["testing"]): void {
  const size = testing?.shardSize;
  if (size === undefined) {
    return;
  }
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`testing.shardSize must be a positive integer, got ${String(size)}`);
  }
  if (testing?.runner === undefined) {
    throw new Error("testing.shardSize requires testing.runner (workers set their own shardSize)");
  }
}

function assertThreads(threads: number | undefined): void {
  if (threads !== undefined && (!Number.isInteger(threads) || threads < 0)) {
    throw new Error(
      `testing.compare.threads must be a non-negative integer, got ${String(threads)}`,
    );
  }
}

function assertNotificationsConfig(config: unknown): void {
  if (config === undefined) {
    return;
  }
  const result = notificationsConfigSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid notifications.config: ${issues}`);
  }
}
