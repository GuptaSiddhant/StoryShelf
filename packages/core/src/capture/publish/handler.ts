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
  return {
    accepts: hasBuild,
    run: async (job, context) => {
      const build = await new BuildModel(options.db).get(job.buildId);
      if (!build) {
        context.logger.warn("build is gone; dropping publish job");
        return;
      }
      context.signal.throwIfAborted();
      await publishOnce(options, job, context, build.projectId);
    },
  };
}

async function publishOnce(
  options: PublishHandlerOptions,
  job: ConsumerJob,
  context: { logger: Logger; touch: () => void; signal: AbortSignal },
  projectId: string,
): Promise<void> {
  const { completer, storage, scratchDir, limits, db } = options;
  try {
    await publishStoredZip(
      {
        storage,
        scratchDir,
        limits,
        db,
        logger: context.logger,
        touch: touchUnlessAborted(context),
        signal: context.signal,
      },
      { projectId, buildId: job.buildId },
    );
  } catch (error) {
    // Resolves only for a cap breach (final); every other outcome throws.
    await settleFailure(options, job, { error, signal: context.signal });
    return;
  }
  context.signal.throwIfAborted();
  await completer.complete(job.buildId, { ok: true });
}

/**
 * A failed publication: a cap breach is final, the last attempt fails the build, any other error is
 * rethrown for a retry. Past its deadline the attempt writes nothing: the lease lapses and the
 * redelivery (or the `exhausted` hook, when none is left) settles the build.
 */
async function settleFailure(
  options: PublishHandlerOptions,
  job: ConsumerJob,
  failure: { error: unknown; signal: AbortSignal },
): Promise<void> {
  const { error, signal } = failure;
  const permanent = error instanceof ZipLimitError;
  if (signal.aborted) {
    throw error;
  }
  if (permanent || (job.attempt ?? 1) >= (job.maxAttempts ?? 1)) {
    await options.completer.complete(job.buildId, { ok: false, error: messageOf(error) });
  }
  if (!permanent) {
    throw error;
  }
}

/** Publishing reports progress after extraction and after persisting: past the deadline the next report stops it. */
function touchUnlessAborted(context: { touch: () => void; signal: AbortSignal }): () => void {
  return () => {
    context.signal.throwIfAborted();
    context.touch();
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
