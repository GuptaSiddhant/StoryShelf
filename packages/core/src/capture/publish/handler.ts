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
      await publishOnce(options, job, context, build.projectId);
    },
  };
}

async function publishOnce(
  options: PublishHandlerOptions,
  job: ConsumerJob,
  context: { logger: Logger; touch: () => void },
  projectId: string,
): Promise<void> {
  const { completer, storage, scratchDir, limits } = options;
  try {
    await publishStoredZip(
      { storage, scratchDir, limits, logger: context.logger, touch: context.touch },
      { projectId, buildId: job.buildId },
    );
  } catch (error) {
    const permanent = error instanceof ZipLimitError;
    if (permanent || (job.attempt ?? 1) >= (job.maxAttempts ?? 1)) {
      await completer.complete(job.buildId, { ok: false, error: messageOf(error) });
    }
    if (permanent) {
      return;
    }
    throw error;
  }
  await completer.complete(job.buildId, { ok: true });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
