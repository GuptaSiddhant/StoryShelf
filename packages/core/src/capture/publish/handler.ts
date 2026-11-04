import type { DatabaseAdapter } from "../../adapters/database.ts";
/** The `publish` job handler of the consumer (ADR 0006, decision 10): publish a stored zip, then complete the build. */
import type { StorageAdapter } from "../../adapters/storage.ts";
import type { Logger } from "../../logger.ts";
import { BuildModel } from "../../models/build.ts";
import type { ConsumerJob, KindHandler } from "../consumer/types.ts";
import type { PublishCompleter } from "./complete.ts";
import { ZipLimitError, type ExtractionLimits } from "./limits.ts";
import { publishStoredZip } from "./run.ts";

/** What {@link createPublishHandler} needs. */
export interface PublishHandlerOptions {
  db: DatabaseAdapter;
  storage: StorageAdapter;
  scratchDir: string;
  limits: ExtractionLimits;
  completer: PublishCompleter;
  logger: Logger;
}

/** The key a running job is tracked under: its row, else its build. */
function keyOf(job: ConsumerJob): string {
  return job.jobId ?? job.buildId;
}

/** A `publish` job needs the build to publish. */
function hasBuild(job: ConsumerJob): boolean {
  return typeof job.buildId === "string" && job.buildId.length > 0;
}

/**
 * The handler. Resolving acks the job. A zip that breaks a cap is a final answer (retrying cannot
 * help): the build is failed and the job acked. Any other error is retried by the consumer, and
 * the build is failed on the last attempt. A redelivery after a lost lease repeats the extraction
 * (same keys) and leaves an already accepted build alone.
 */
export function createPublishHandler(options: PublishHandlerOptions): KindHandler {
  // One abort controller per running job: `cancel` (a cancel or a lost lease) stops its extraction.
  const running = new Map<string, AbortController>();
  return {
    accepts: hasBuild,
    run: async (job, context) => {
      // Registered first: a cancel that arrives while the build is being read still stops the run.
      const controller = new AbortController();
      running.set(keyOf(job), controller);
      try {
        const build = await new BuildModel(options.db).get(job.buildId);
        if (!build) {
          context.logger.warn("build is gone; dropping publish job");
          return;
        }
        await publishOnce(options, job, { ...context, signal: controller.signal }, build.projectId);
      } finally {
        running.delete(keyOf(job));
      }
    },
    // oxlint-disable-next-line eslint/require-await -- the interface is async; aborting is synchronous
    cancel: async (job) => {
      running.get(keyOf(job))?.abort(new Error("publish cancelled"));
    },
  };
}

async function publishOnce(
  options: PublishHandlerOptions,
  job: ConsumerJob,
  context: { logger: Logger; touch: () => void; signal: AbortSignal },
  projectId: string,
): Promise<void> {
  if ((await attemptPublish(options, job, context, projectId)) === "stored") {
    await options.completer.complete(job.buildId, { ok: true });
  }
}

/**
 * Store the zip's files. Answers "stored" only for a run that finished and was not told to stop;
 * a cancelled run, a lost lease and a failure (settled here) all answer "stopped", and the build is
 * not completed by them.
 */
async function attemptPublish(
  options: PublishHandlerOptions,
  job: ConsumerJob,
  context: { logger: Logger; touch: () => void; signal: AbortSignal },
  projectId: string,
): Promise<"stored" | "stopped"> {
  const { storage, scratchDir, limits, db } = options;
  try {
    await publishStoredZip(
      {
        storage,
        scratchDir,
        limits,
        db,
        logger: context.logger,
        touch: context.touch,
        signal: context.signal,
      },
      { projectId, buildId: job.buildId },
    );
  } catch (error) {
    if (context.signal.aborted) return stopped(context.logger);
    await settleFailure(options.completer, job, error);
    return "stopped";
  }
  // The cancel (or the lost lease) may land after the last file: the run finished, but it was told
  // to stop, so it does not complete the build or run the success hooks.
  return context.signal.aborted ? stopped(context.logger) : "stored";
}

/** A run told to stop (cancelled, or its lease lost): the consumer settles the job. */
function stopped(logger: Logger): "stopped" {
  logger.info("publish stopped by a cancel");
  return "stopped";
}

/** A permanent failure (a cap) or the last attempt fails the build; anything else is retried. */
async function settleFailure(
  completer: PublishCompleter,
  job: ConsumerJob,
  error: unknown,
): Promise<void> {
  const permanent = error instanceof ZipLimitError;
  if (permanent || (job.attempt ?? 1) >= (job.maxAttempts ?? 1)) {
    await completer.complete(job.buildId, { ok: false, error: messageOf(error) });
  }
  if (!permanent) {
    throw error;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
