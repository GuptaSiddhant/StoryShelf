import { emitAttemptLog, type AttemptLogRecorder } from "../../models/capture-attempt.ts";
/** What a shard that runs again reports about the work it did twice (visibility only, never a resume). */
import { CaptureLogModel } from "../../models/capture-log.ts";
import { CaptureShardModel } from "../../models/capture-shard.ts";
import type { ShardRepeatedEvent } from "../consumer/metrics.ts";
import type { ShardTarget } from "./context.ts";

/** Where a shard run stands in its job's deliveries; either is absent when the queue did not say. */
export interface ShardDelivery {
  /** This delivery, from 1. */
  attempt?: number | undefined;
  /** Deliveries the queue allows. */
  limit?: number | undefined;
  /** Counts the work done twice (a metrics hook); must not throw. */
  onRepeated?: ((event: ShardRepeatedEvent) => void) | undefined;
}

/**
 * Say that this run re-captured snapshots an earlier run of the shard had already stored: one
 * attempt-log line on the build's plan attempt, one structured log line, and the metrics hook.
 * `removed` is the number of rows the clean-up of the earlier run deleted, which is durable work
 * counted for free, so nothing here reads the database per story. Nothing is said for a clean first
 * run, and nothing here changes what the shard renders or persists.
 */
export async function reportRepeatedWork(
  target: ShardTarget,
  ordinal: number,
  delivery: ShardDelivery,
  removed: number,
): Promise<void> {
  if (removed === 0) {
    return;
  }
  const where =
    delivery.attempt !== undefined && delivery.limit !== undefined
      ? ` (attempt ${delivery.attempt} of ${delivery.limit})`
      : "";
  const message = `re-captured ${removed} ${removed === 1 ? "snapshot" : "snapshots"} an earlier attempt of shard ${ordinal} had already stored${where}`;
  const fields = {
    shard: ordinal,
    repeated: removed,
    ...(delivery.attempt === undefined ? {} : { attempt: delivery.attempt }),
    ...(delivery.limit === undefined ? {} : { limit: delivery.limit }),
  };
  target.options.logger?.warn({ buildId: target.build.id, ...fields }, message);
  await emitAttemptLog(
    await recorderOrNone(target),
    target.options.logger,
    "warn",
    message,
    fields,
  );
  try {
    delivery.onRepeated?.({
      repeated: removed,
      ...(delivery.attempt === undefined ? {} : { attempt: delivery.attempt }),
      ...(delivery.limit === undefined ? {} : { limit: delivery.limit }),
    });
  } catch {
    // A metrics hook must never break the shard.
  }
}

/** The plan attempt's recorder, or none when it cannot be looked up: saying so is never worth failing the shard. */
async function recorderOrNone(target: ShardTarget): Promise<AttemptLogRecorder | undefined> {
  try {
    return await planAttemptLog(target);
  } catch (error) {
    target.options.logger?.warn(
      { err: error, buildId: target.build.id },
      "could not find the build's attempt log; the repeated work is logged here only",
    );
    return undefined;
  }
}

/** A recorder for the plan's attempt (where the build's log history lives), or none without one. */
async function planAttemptLog(target: ShardTarget): Promise<AttemptLogRecorder | undefined> {
  const { options, build, project } = target;
  const attemptId = (await new CaptureShardModel(options.db).plan(build.id))?.attemptId;
  if (!attemptId) {
    return undefined;
  }
  const logs = new CaptureLogModel(options.db, options.tables);
  return async (level, message, fields) => {
    await logs.append(project.id, build.id, attemptId, level, message, fields);
  };
}
