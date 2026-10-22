/** The `capture` kind's handler: builds the existing core dispatch from the host's adapters. */
import type { CaptureRunner } from "../../adapters/capture-runner.ts";
import type { DatabaseAdapter } from "../../adapters/database.ts";
import type { DesignProvider } from "../../adapters/design.ts";
import type { NotifierProvider } from "../../adapters/notifier/provider.ts";
import type { StorageAdapter } from "../../adapters/storage.ts";
import type { ShelfConfig } from "../../config.ts";
import type { Logger } from "../../logger.ts";
import type { SecretInput } from "../../utils/encrypt.ts";
import { createBuildStatePublisher } from "../build-state/publisher.ts";
import type { BuildStatePublisher } from "../build-state/types.ts";
import { createDispatchJob, type CaptureDispatchJob, type DispatchDeps } from "../dispatch.ts";
import type { CaptureJobOptions, ShardJob } from "../orchestrator.ts";
import { DEFAULT_MAX_RETRIES, retriesOf } from "./retry.ts";
import type { ConsumerJob, KindHandler } from "./types.ts";

/** What the capture handler needs: the same adapters the server's own capture setup uses. */
export interface CaptureHandlerOptions {
  /** Database adapter; its own `tables` are used (never a dialect's defaults). */
  db: DatabaseAdapter;
  storage: StorageAdapter;
  /** Pure renderer; `cancel` is called when a job's lease is lost or the job is cancelled. */
  runner: CaptureRunner;
  /** Scratch directory for Storybook extraction. */
  scratchDir: string;
  logger: Logger;
  /** Puts a shard job on the queue; sharding needs it. Defaults to the consumed queue's `enqueue`. */
  enqueue: (job: ShardJob) => Promise<void>;
  /** Notifier providers; `state` channels (git hosts) get the build statuses. */
  notifiers?: NotifierProvider[];
  /**
   * Shows a build's state on its git channels at every transition. Default: deliver inline through
   * `notifiers` (a capture always has `testing` on); the app passes its queue-backed publisher.
   */
  buildState?: BuildStatePublisher;
  /** Links in statuses are absolute from `publicBaseUrl`; published Storybooks use `publishedBaseDomain`. */
  config?: Pick<ShelfConfig, "publicBaseUrl" | "publishedBaseDomain">;
  /** Design providers validating declared design links during capture. */
  design?: DesignProvider[];
  /** Server secret for webhook decryption. */
  secret?: SecretInput;
  viewports?: CaptureJobOptions["viewports"];
  /** Captures per shard; unset keeps every build in one job. */
  shardSize?: number;
  /** Retries assumed for jobs that do not state `maxAttempts` (default 2). */
  maxRetries?: number;
}

/** Whether a polled capture job carries the minimum shape to execute. */
function isValidCaptureJob(job: ConsumerJob): boolean {
  return typeof job.buildId === "string" && job.buildId.length > 0;
}

/** The `capture` handler: runs `createDispatchJob`'s runner, cancels through `runner.cancel`. */
export function createCaptureHandler(options: CaptureHandlerOptions): KindHandler {
  const fallbackRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  // The shard rule ("a shard's last try is its final word") depends on the queue's retry limit,
  // which a database job states itself, so one dispatch exists per distinct limit.
  const dispatches = new Map<number, ReturnType<typeof createDispatchJob>>();
  const dispatchFor = (retries: number): ReturnType<typeof createDispatchJob> => {
    const existing = dispatches.get(retries);
    if (existing !== undefined) {
      return existing;
    }
    const created = createDispatchJob(captureDispatchDeps(options, retries));
    dispatches.set(retries, created);
    return created;
  };
  dispatchFor(fallbackRetries);
  return {
    accepts: isValidCaptureJob,
    run: async (job, context) => {
      await dispatchFor(retriesOf(job, fallbackRetries))(toDispatchJob(job), {
        touch: () => {
          context.touch();
        },
      });
    },
    cancel: async (job) => {
      await options.runner.cancel(job.buildId, job.shard);
    },
  };
}

function toDispatchJob(job: ConsumerJob): CaptureDispatchJob {
  return {
    buildId: job.buildId,
    shard: job.shard,
    attempts: job.attempts,
    ...(job.reqId === undefined ? {} : { reqId: job.reqId }),
    ...(job.traceparent === undefined ? {} : { traceparent: job.traceparent }),
  };
}

/** The dispatch dependencies the handler runs captures with; the host reuses them to write failures the pipeline never got to. */
export function captureDispatchDeps(
  options: CaptureHandlerOptions,
  maxRetries: number,
): DispatchDeps {
  const t = options.db.tables;
  const jobOptions: CaptureJobOptions = {
    db: options.db,
    tables: {
      projects: t.projects,
      builds: t.builds,
      buildLabels: t.buildLabels,
      snapshots: t.snapshots,
      baselines: t.baselines,
      captureAttempts: t.captureAttempts,
      captureLogs: t.captureLogs,
    },
    storage: options.storage,
    runner: options.runner,
    scratchDir: options.scratchDir,
    viewports: options.viewports,
    logger: options.logger,
    secret: options.secret,
    design: options.design,
    shardSize: options.shardSize,
    enqueue: options.enqueue,
  };
  return {
    db: options.db,
    tables: {
      projects: t.projects,
      builds: t.builds,
      buildLabels: t.buildLabels,
      snapshots: t.snapshots,
      captureAttempts: t.captureAttempts,
      captureLogs: t.captureLogs,
    },
    jobOptions,
    buildState: options.buildState ?? inlineBuildState(options),
    logger: options.logger,
    maxRetries,
  };
}

/** Inline delivery of captured builds' states through the handler's own adapters. */
function inlineBuildState(options: CaptureHandlerOptions): BuildStatePublisher {
  return createBuildStatePublisher({
    deps: {
      db: options.db,
      storage: options.storage,
      notifiers: options.notifiers ?? [],
      secret: options.secret,
      config: options.config ?? {},
      flags: () => ({ testing: true, review: false }),
      logger: options.logger,
    },
  });
}
