// oxlint-disable typescript/no-deprecated -- this module is where the deprecated aliases are read
/** Folds the nested `capture` / `compare` options and their deprecated flat aliases into one shape (ADR 0031 phase 2). */
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ShelfConfig, ShelfOptions } from "./config.ts";

/** Where capture scratch lives when `config.scratchDir` is not set. */
export const DEFAULT_SCRATCH_DIR: string = join(tmpdir(), "storyshelf");

/** Result of {@link normalizeShelfOptions}. */
export interface NormalizedShelfOptions {
  /**
   * Options with `capture` filled in and the flat `captureRunner` / `captureQueue` /
   * `config.captureConcurrency` mirrored from it, so internals keep reading one place.
   */
  options: ShelfOptions;
  /** Deprecated flat keys the caller used, each with its replacement. For a one-time boot warning. */
  deprecated: string[];
}

/**
 * Normalise capture and compare options.
 *
 * - Nested `capture.{runner,queue,concurrency}` wins over the deprecated flat aliases
 *   (`captureRunner`, `captureQueue`, `config.captureConcurrency`); a flat key that disagrees with
 *   the nested one is reported as ignored.
 * - Likewise `notifications.{notifiers,defaults}` over `notifiers` and `config.notifications`.
 * - `compare.threads` must be a non-negative integer.
 * - `config.scratchDir` defaults to {@link DEFAULT_SCRATCH_DIR} once something needs it (a runner,
 *   or inline statics extraction); hosting-only deployments stay untouched.
 */
export function normalizeShelfOptions(raw: ShelfOptions): NormalizedShelfOptions {
  assertThreads(raw.compare?.threads);
  const deprecated = deprecatedKeys(raw);
  const capture = {
    runner: raw.capture?.runner ?? raw.captureRunner,
    queue: raw.capture?.queue ?? raw.captureQueue,
    concurrency: raw.capture?.concurrency ?? raw.config?.captureConcurrency,
  };
  const notifications = {
    notifiers: raw.notifications?.notifiers ?? raw.notifiers,
    defaults: raw.notifications?.defaults ?? raw.config?.notifications,
  };
  const config = withDerivedConfig(raw.config, capture, notifications.defaults);
  const options: ShelfOptions = {
    ...raw,
    capture,
    captureRunner: capture.runner,
    captureQueue: capture.queue,
    notifications,
    notifiers: notifications.notifiers,
    ...(config ? { config } : {}),
  };
  return { options, deprecated };
}

function withDerivedConfig(
  config: ShelfConfig | undefined,
  capture: { runner?: unknown; concurrency?: number },
  notificationDefaults: ShelfConfig["notifications"],
): ShelfConfig | undefined {
  const needsScratch = capture.runner !== undefined || (config?.maxInlineUnzipSize ?? 0) > 0;
  const derived: ShelfConfig = {
    ...config,
    ...(capture.concurrency === undefined ? {} : { captureConcurrency: capture.concurrency }),
    ...(notificationDefaults === undefined ? {} : { notifications: notificationDefaults }),
    ...(needsScratch ? { scratchDir: config?.scratchDir ?? DEFAULT_SCRATCH_DIR } : {}),
  };
  return Object.keys(derived).length > 0 ? derived : undefined;
}

function deprecatedKeys(raw: ShelfOptions): string[] {
  const keys: string[] = [];
  const note = (flat: string, nested: string, used: boolean, conflicts: boolean): void => {
    if (used) {
      keys.push(`${flat} → ${nested}${conflicts ? " (ignored: both set)" : ""}`);
    }
  };
  note(
    "captureRunner",
    "capture.runner",
    raw.captureRunner !== undefined,
    raw.capture?.runner !== undefined,
  );
  note(
    "captureQueue",
    "capture.queue",
    raw.captureQueue !== undefined,
    raw.capture?.queue !== undefined,
  );
  note(
    "config.captureConcurrency",
    "capture.concurrency",
    raw.config?.captureConcurrency !== undefined,
    raw.capture?.concurrency !== undefined,
  );
  note(
    "notifiers",
    "notifications.notifiers",
    raw.notifiers !== undefined,
    raw.notifications?.notifiers !== undefined,
  );
  note(
    "config.notifications",
    "notifications.defaults",
    raw.config?.notifications !== undefined,
    raw.notifications?.defaults !== undefined,
  );
  return keys;
}

function assertThreads(threads: number | undefined): void {
  if (threads !== undefined && (!Number.isInteger(threads) || threads < 0)) {
    throw new Error(`compare.threads must be a non-negative integer, got ${String(threads)}`);
  }
}
