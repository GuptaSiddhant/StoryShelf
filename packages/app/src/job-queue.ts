/**
 * The app's one job queue (ADR 0006, decision 4): the database queue, built on first use and
 * shared by every job kind. Capture, publish and notify jobs are enqueued onto it and consumed by
 * one consumer with a handler per kind. Building it lazily keeps hosts that never enqueue or
 * consume (OpenAPI generation, stub-table tests) from touching `capture_jobs`.
 */
import type { CaptureQueue } from "@storyshelf/core/adapter/capture-queue";
import {
  createDatabaseCaptureQueue,
  DATABASE_QUEUE_METADATA,
  type DatabaseCaptureQueue,
  type DatabaseJob,
} from "@storyshelf/core/capture";
import type { ShelfOptions } from "@storyshelf/core/config";
import type { CaptureJobKind } from "@storyshelf/core/schema";

/** What a kind does when a job of it failed because its last attempt lost its lease. */
export type ExhaustedHandler = (job: DatabaseJob, error: string) => Promise<void>;

/** The shared database queue. */
export interface JobQueue {
  /** Job kinds this instance polls; empty when it consumes none. */
  kinds: readonly CaptureJobKind[];
  /** The queue, built on first use. */
  get(): DatabaseCaptureQueue;
  /** The queue if it was ever built. */
  built(): DatabaseCaptureQueue | undefined;
  /** Capture-shaped view for pages and the store; builds the queue only when called. */
  view: CaptureQueue;
  /** Per-kind hooks for exhausted jobs, filled in by the kind's setup. */
  exhausted: Partial<Record<CaptureJobKind, ExhaustedHandler>>;
}

/** Create the lazy queue polling `kinds`, with `retries` after a first failed attempt. */
export function createJobQueue(
  options: ShelfOptions,
  kinds: readonly CaptureJobKind[],
  retries: number,
): JobQueue {
  let queue: DatabaseCaptureQueue | undefined;
  const exhausted: JobQueue["exhausted"] = {};
  const get = (): DatabaseCaptureQueue => {
    queue ??= createDatabaseCaptureQueue(options.database, {
      kinds: kinds.length > 0 ? kinds : ["capture"],
      retries,
      onExhausted: async (job, error) => {
        await exhausted[job.kind]?.(job, error);
      },
    });
    return queue;
  };
  return { kinds, get, built: () => queue, view: queueView(get), exhausted };
}

function queueView(get: () => DatabaseCaptureQueue): CaptureQueue {
  return {
    metadata: DATABASE_QUEUE_METADATA,
    enqueue: async (job) => {
      await get().enqueue(job);
    },
    status: async (buildId) => await get().status(buildId),
    active: async () => await get().active(),
    recent: async (limit) => await get().recent(limit),
  };
}
