/**
 * Create the database capture queue (ADR 0006, decision 4): `capture_jobs` on the app's own
 * `DatabaseAdapter` is the queue, safe with any number of instances.
 *
 * Composition root: wires the runtime, lifecycle, enqueue/cancel/views (`operations`), the claim
 * (`claim`, `poll`) and the lease (`lease`) into a `PollableCaptureQueue`. Every attempt has its own
 * row `<jobId>:<attempt>`, created by a unique-key insert, so claiming needs no compare-and-swap and
 * a holder only ever writes its own attempt row.
 */
import { hostname } from "node:os";
import type { DatabaseAdapter } from "../../adapters/database.ts";
import type { Logger } from "../../logger.ts";
import { CaptureJobModel } from "../../models/capture-job.ts";
import { ulid } from "../../utils/ulid.ts";
import { extendJob, inspectJob } from "./lease.ts";
import { buildQueueLifecycle } from "./lifecycle.ts";
import {
  activeEntries,
  cancelJobs,
  enqueueCapture,
  enqueueJob,
  recentEntries,
  statusOf,
} from "./operations.ts";
import { ackJob, nackJob, pollJob } from "./poll.ts";
import {
  DEFAULT_LEASE_MS,
  DEFAULT_RETRIES,
  type DatabaseCaptureQueue,
  type DatabaseCaptureQueueOptions,
  type QueueRuntime,
} from "./types.ts";
import { createWakeSignal } from "./wake.ts";

declare const __PKG_VERSION__: string | undefined;

/** What the database queue reports about itself; hosts show it before the queue is built. */
export const DATABASE_QUEUE_METADATA = {
  name: "Database Queue",
  version: typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "0.0.0",
  description: "Capture queue on the app database (capture_jobs)",
  kind: "database",
  category: "capture-queue",
} as const;

/** A `PollableCaptureQueue` over `db`'s `capture_jobs` table. */
export function createDatabaseCaptureQueue(
  db: DatabaseAdapter,
  options: DatabaseCaptureQueueOptions = {},
): DatabaseCaptureQueue {
  const rt = resolveRuntime(db, options);
  return {
    metadata: DATABASE_QUEUE_METADATA,
    lifecycle: buildQueueLifecycle(rt),
    setLogger(bound: Logger): void {
      rt.logger ??= bound;
    },
    enqueue: async (job) => {
      await enqueueCapture(rt, job);
    },
    enqueueJob: async (job) => await enqueueJob(rt, job),
    status: async (buildId) => await statusOf(rt, buildId),
    active: async () => await activeEntries(rt),
    recent: async (limit) => await recentEntries(rt, limit),
    cancel: async (id) => await cancelJobs(rt, id),
    poll: async (pollOptions) => await pollJob(rt, pollOptions),
    ack: async (job) => {
      await ackJob(rt, job);
    },
    nack: async (job, nackOptions) => {
      await nackJob(rt, job, nackOptions);
    },
    extend: async (job) => await extendJob(rt, job),
    inspect: async (job) => await inspectJob(rt, job),
    waitForWork: async (ms) => await rt.wake.wait(ms, rt.pollVersion),
  };
}

function resolveRuntime(db: DatabaseAdapter, options: DatabaseCaptureQueueOptions): QueueRuntime {
  const kinds = options.kinds ?? ["capture"];
  const retries = options.retries ?? DEFAULT_RETRIES;
  if (kinds.length === 0) {
    throw new Error("createDatabaseCaptureQueue: `kinds` must name at least one job kind");
  }
  if (!Number.isInteger(retries) || retries < 0) {
    throw new Error("createDatabaseCaptureQueue: `retries` must be a non-negative integer");
  }
  const rt: QueueRuntime = {
    model: new CaptureJobModel(db),
    kinds,
    leaseMs: positive(options.leaseMs, DEFAULT_LEASE_MS),
    maxAttempts: retries + 1,
    owner: options.owner ?? `${hostname()}:${String(process.pid)}:${ulid().slice(-6)}`,
    now: options.now ?? Date.now,
    wake: createWakeSignal(options.timers),
    pollVersion: 0,
  };
  return withHooks(rt, options);
}

/** The optional logger and exhausted-job hook, when given. */
function withHooks(rt: QueueRuntime, options: DatabaseCaptureQueueOptions): QueueRuntime {
  if (options.logger !== undefined) {
    rt.logger = options.logger;
  }
  if (options.onExhausted !== undefined) {
    rt.onExhausted = options.onExhausted;
  }
  return rt;
}

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

export {
  DEFAULT_LEASE_MS,
  DEFAULT_RETRIES,
  type DatabaseCaptureQueue,
  type DatabaseCaptureQueueOptions,
  type DatabaseJob,
  type QueueJobInput,
} from "./types.ts";
export { LEASE_EXHAUSTED_ERROR } from "./claim.ts";
export { MAX_NACK_DELAY_MS } from "./poll.ts";
