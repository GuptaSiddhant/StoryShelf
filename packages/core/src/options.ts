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
  assertNotificationsConfig(options.notifications?.config);
  if (options.config?.scratchDir !== undefined) {
    return options;
  }
  return { ...options, config: { ...options.config, scratchDir: DEFAULT_SCRATCH_DIR } };
}

function assertTestingProcess(testing: ShelfOptions["testing"]): void {
  if (testing?.workerEntry !== undefined && testing.runner === undefined) {
    throw new Error("testing.workerEntry requires testing.runner (it is the in-process fallback)");
  }
  if (testing?.mode === "fork" && testing.workerEntry === undefined) {
    throw new Error('testing.mode "fork" requires testing.workerEntry');
  }
  assertShardSize(testing);
  assertConcurrency(testing?.concurrency);
}

/** `0` would deadlock the in-process queue, and the forked child would silently ignore it. */
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
