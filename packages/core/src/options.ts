/** Resolves `ShelfOptions` once at boot: validates `compare` and fills the capture scratch default. */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { notificationsConfigSchema, type ShelfOptions } from "./config.ts";

/** Where capture scratch lives when `config.scratchDir` is not set. */
export const DEFAULT_SCRATCH_DIR: string = join(tmpdir(), "storyshelf");

/**
 * Validate and complete the options.
 *
 * - `compare.threads` must be a non-negative integer.
 * - `notifications.config` must match its schema (it used to live in `ShelfConfig`, which validated it).
 * - `config.scratchDir` defaults to {@link DEFAULT_SCRATCH_DIR} once something needs it (a runner,
 *   or inline statics extraction); hosting-only deployments stay untouched.
 */
export function resolveShelfOptions(options: ShelfOptions): ShelfOptions {
  assertThreads(options.compare?.threads);
  assertNotificationsConfig(options.notifications?.config);
  const needsScratch =
    options.capture?.runner !== undefined || (options.config?.maxInlineUnzipSize ?? 0) > 0;
  if (!needsScratch || options.config?.scratchDir !== undefined) {
    return options;
  }
  return { ...options, config: { ...options.config, scratchDir: DEFAULT_SCRATCH_DIR } };
}

function assertThreads(threads: number | undefined): void {
  if (threads !== undefined && (!Number.isInteger(threads) || threads < 0)) {
    throw new Error(`compare.threads must be a non-negative integer, got ${String(threads)}`);
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
