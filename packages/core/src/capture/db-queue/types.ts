/** Option, job and runtime types of the database capture queue. */
import type {
  CaptureJob,
  LeaseRenewal,
  PollableCaptureQueue,
  PollableJob,
} from "../../adapters/capture-queue.ts";
import type { AdapterLifecycle } from "../../adapters/metadata.ts";
import type { Logger } from "../../logger.ts";
import type { CaptureJobModel } from "../../models/capture-job.ts";
import type { CaptureJobKind } from "../../schema/capture-job.ts";
import type { QueueTimers } from "./timers.ts";
import type { WakeSignal } from "./wake.ts";

/** Options of {@link createDatabaseCaptureQueue}. */
export interface DatabaseCaptureQueueOptions {
  /** Job kinds this instance polls (default `["capture"]`); enqueue accepts every kind. */
  kinds?: readonly CaptureJobKind[];
  /** Lease granted per attempt, renewed by progress (default {@link DEFAULT_LEASE_MS}). */
  leaseMs?: number;
  /** Retries after the first attempt (`testing.retries`, default 2: three attempts in total). */
  retries?: number;
  /** Identity written on the attempt rows this instance holds (default host, pid and a random tag). */
  owner?: string;
  /** Clock in epoch ms (default `Date.now`); tests inject one to drive leases and visibility. */
  now?: () => number;
  /** Timers of the local wake wait (default the global timers); tests inject a manual clock. */
  timers?: QueueTimers;
  /** Explicit logger override; the host normally binds one through `setLogger`. */
  logger?: Logger;
  /**
   * Called after a job failed because its last attempt lost its lease: nothing was running to
   * record the failure, so the host writes it (a build left `capturing`). May run on every
   * instance that finds the job, so it must be idempotent; a throw is logged and ignored.
   */
  onExhausted?: (job: DatabaseJob, error: string) => Promise<void>;
}

/** Default lease per attempt: long enough for a slow stage, short enough to recover a crash. */
export const DEFAULT_LEASE_MS = 5 * 60_000;

/** Default `testing.retries` (ADR 0006, decision 11). */
export const DEFAULT_RETRIES = 2;

/** A job of any kind, as `enqueueJob` takes it. */
export interface QueueJobInput {
  kind: CaptureJobKind;
  /** Build the job works on; notify jobs may have none. */
  buildId?: string | null;
  /** `capture_shards` row, for a shard capture job. */
  shard?: string;
  reqId?: string;
  traceparent?: string;
  /** Kind-specific fields (channel id, zip key, …), stored as JSON. */
  data?: Record<string, unknown>;
}

/** A job claimed from the database queue. */
export interface DatabaseJob extends PollableJob {
  /** Id of the job row (`receipt` is the attempt row, `<jobId>:<attempt>`). */
  jobId: string;
  kind: CaptureJobKind;
  /** Attempt number, from 1 (`attempts` is the number made before this one). */
  attempt: number;
  maxAttempts: number;
  /** Kind-specific fields given at enqueue. */
  data: Record<string, unknown>;
}

/** The database queue: a {@link PollableCaptureQueue} plus multi-kind enqueue and a local wake. */
export interface DatabaseCaptureQueue extends PollableCaptureQueue {
  readonly lifecycle: AdapterLifecycle;
  poll(options?: { waitMs?: number }): Promise<DatabaseJob | null>;
  extend(job: PollableJob): Promise<LeaseRenewal>;
  /** Put a job of any kind on the queue; resolves to its job id. */
  enqueueJob(job: QueueJobInput): Promise<string>;
  /** Cancel a job by job id, or every unfinished job of this queue's kinds for a build by build id. */
  cancel(id: string): Promise<boolean>;
  /** Read the job's state without renewing its lease (the 5 s cancel check). */
  inspect(job: PollableJob): Promise<LeaseRenewal>;
  /**
   * Resolve true when this instance enqueues a job (including one enqueued since the last `poll`
   * began, so no wake-up is lost), false after `ms`.
   */
  waitForWork(ms: number): Promise<boolean>;
}

/** State shared by the queue's modules. */
export interface QueueRuntime {
  model: CaptureJobModel;
  kinds: readonly CaptureJobKind[];
  leaseMs: number;
  maxAttempts: number;
  owner: string;
  now: () => number;
  wake: WakeSignal;
  /** Wake version read when the latest poll began. */
  pollVersion: number;
  logger?: Logger;
  onExhausted?: DatabaseCaptureQueueOptions["onExhausted"];
}

/** The capture-shaped job `enqueue` takes, re-exported for the modules. */
export type { CaptureJob };
