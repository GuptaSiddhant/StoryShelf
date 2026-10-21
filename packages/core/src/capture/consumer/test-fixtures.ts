/** Shared set-up of the consumer tests: a manual clock, the database queue on the fake DB, a stub logger. */
import { vi } from "vitest";
import type { DatabaseAdapter } from "../../adapters/database.ts";
import type { Logger } from "../../logger.ts";
import type { CaptureJobKind } from "../../schema/capture-job.ts";
import { makeDatabase } from "../../test-helpers/fake-database.ts";
import { createManualClock, type ManualClock } from "../../test-helpers/manual-clock.ts";
import { createDatabaseCaptureQueue } from "../db-queue/index.ts";
import type { DatabaseCaptureQueue, DatabaseJob } from "../db-queue/types.ts";
import { createCaptureConsumer } from "./index.ts";
import type { CaptureConsumerOptions, ConsumerJob, JobHandlers } from "./types.ts";

/** A logger whose children are itself, so a test sees every line of every scope. */
export interface StubLogger {
  logger: Logger;
  calls: { level: string; fields: unknown; message: unknown }[];
  children: Record<string, unknown>[];
}

export function stubLogger(): StubLogger {
  const calls: StubLogger["calls"] = [];
  const children: Record<string, unknown>[] = [];
  const stub: Record<string, unknown> = {
    child: (bindings: Record<string, unknown>): unknown => {
      children.push(bindings);
      return stub;
    },
  };
  for (const level of ["trace", "debug", "info", "warn", "error", "fatal"]) {
    stub[level] = (fields: unknown, message?: unknown): void => {
      calls.push({ level, fields, message });
    };
  }
  return { logger: stub as unknown as Logger, calls, children };
}

/** A promise a test settles by hand, to hold a handler mid-run. */
export function gate(): { promise: Promise<null>; open: () => void } {
  const { promise, resolve } = Promise.withResolvers<null>();
  return {
    promise,
    open: () => {
      resolve(null);
    },
  };
}

export interface Rig {
  clock: ManualClock;
  db: DatabaseAdapter;
  queue: DatabaseCaptureQueue;
  log: StubLogger;
  /** Consumer built over `queue` with the clock injected. */
  consume: (
    overrides?: Partial<CaptureConsumerOptions>,
  ) => ReturnType<typeof createCaptureConsumer>;
}

/** The database queue and a consumer factory sharing one manual clock. */
export function rig(
  options: {
    handlers?: JobHandlers;
    kinds?: readonly CaptureJobKind[];
    retries?: number;
    concurrency?: number;
    db?: DatabaseAdapter;
  } = {},
): Rig {
  const clock = createManualClock();
  const db = options.db ?? makeDatabase().db;
  const retries = options.retries ?? 2;
  const queue = createDatabaseCaptureQueue(db, {
    kinds: options.kinds ?? ["capture"],
    retries,
    now: clock.now,
    timers: clock.timers,
  });
  const log = stubLogger();
  return {
    clock,
    db,
    queue,
    log,
    consume: (overrides = {}) =>
      createCaptureConsumer({
        queue,
        handlers: options.handlers ?? {},
        config: { concurrency: options.concurrency ?? 1, maxRetries: retries, backoffMs: 1000 },
        now: clock.now,
        timers: clock.timers,
        random: () => 0,
        logger: log.logger,
        ...overrides,
      }),
  };
}

/** A handler spy that records the jobs it ran and can be held open. */
export function recordingHandler(hold?: Promise<null>): {
  run: (job: ConsumerJob) => Promise<void>;
  jobs: ConsumerJob[];
} {
  const jobs: ConsumerJob[] = [];
  return {
    jobs,
    run: vi.fn(async (job: ConsumerJob) => {
      jobs.push(job);
      await hold;
    }),
  };
}

export type { DatabaseJob };
