/**
 * Single-flight job kinds (ADR 0040): at most one non-terminal job per `activeKey`, enforced by the
 * unique `capture_jobs.active_key` column rather than by a check before the insert.
 *
 * A request for a key that is already held is never lost and never doubled:
 *
 * - the holder is `queued`: it reads the current state when it runs, so the request is covered;
 * - the holder is `running`: it may have read the state before this change, so a marker is set on
 *   it, and when it ends a successor job runs one more pass;
 * - the holder ended meanwhile: the key is free, so the request becomes a job of its own.
 */
import type { CaptureJobRow, CaptureJobStatus } from "../../schema/capture-job.ts";
import { ulid } from "../../utils/ulid.ts";
import { isoAt } from "./clock.ts";
import { encodePayload } from "./codec.ts";
import type { QueueJobInput, QueueRuntime } from "./types.ts";

/** Rounds a request makes while the holder of its key keeps ending under it. */
const MAX_ROUNDS = 5;

/** What a keyed job is made of; the payload is already encoded. */
interface KeyedJob {
  kind: CaptureJobRow["kind"];
  buildId: string | null;
  shardId: string | null;
  maxAttempts: number;
  payload: string | null;
  activeKey: string;
}

/** Enqueue a job that holds `activeKey`; resolves to the id of the job that now covers the request. */
export async function enqueueKeyed(
  rt: QueueRuntime,
  job: QueueJobInput & { activeKey: string },
): Promise<string> {
  return await insertKeyed(rt, {
    kind: job.kind,
    buildId: job.buildId ?? null,
    shardId: job.shard ?? null,
    maxAttempts: job.maxAttempts ?? rt.maxAttempts,
    payload: encodePayload(job),
    activeKey: job.activeKey,
  });
}

async function insertKeyed(rt: QueueRuntime, job: KeyedJob): Promise<string> {
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const id = ulid();
    // oxlint-disable-next-line no-await-in-loop -- each round depends on what the last one found
    const result = await rt.model.createKeyed({ id, ...job }, isoAt(rt));
    if ("created" in result) {
      rt.logger?.info({ jobId: id, kind: job.kind, buildId: job.buildId }, "job queued");
      rt.wake.notify();
      return id;
    }
    // oxlint-disable-next-line no-await-in-loop -- see above
    if (await covered(rt, result.holder)) {
      return result.holder.jobId;
    }
  }
  throw new Error(`could not enqueue a job for ${job.activeKey}: its holder kept ending`);
}

/** Whether the holder of the key will see the request; marks a running holder for one more pass. */
async function covered(rt: QueueRuntime, holder: CaptureJobRow): Promise<boolean> {
  if (holder.status === "queued") {
    rt.logger?.debug(
      { jobId: holder.jobId, kind: holder.kind },
      "request coalesced into queued job",
    );
    return true;
  }
  const now = await rt.model.requestRerun(holder.jobId, isoAt(rt));
  const open = now !== null && (now.status === "running" || now.status === "queued");
  if (open) {
    rt.logger?.debug({ jobId: holder.jobId, kind: holder.kind }, "rerun requested on running job");
  }
  return open;
}

/**
 * End a job `done` or `failed`, freeing its key. If a request arrived while it ran, a successor
 * job takes the key at once, so the state change that came in during the pass still gets one. A
 * cancelled job asks for no successor: that is the end the user chose.
 *
 * `row` is the job row as read before the write; the key is gone from the row once it ends.
 */
export async function finishJob(
  rt: QueueRuntime,
  row: CaptureJobRow,
  status: Extract<CaptureJobStatus, "done" | "failed">,
  error: string | null = null,
): Promise<void> {
  await rt.model.finishJob(row.jobId, status, isoAt(rt), error);
  await startSuccessor(rt, row);
}

/**
 * After a job ended: if a request arrived while it ran, a successor takes its key at once. For a
 * job that ended a way other than {@link finishJob} (the exhausted-job path), after its own write.
 */
export async function startSuccessor(rt: QueueRuntime, row: CaptureJobRow): Promise<void> {
  if (row.activeKey === null) {
    return;
  }
  // The marker can only be set while the job runs, and the write above ended that, so this read is final.
  const ended = await rt.model.get(row.jobId);
  if ((ended?.rerunRequestedAt ?? null) === null) {
    return;
  }
  await insertKeyed(rt, {
    kind: row.kind,
    buildId: row.buildId,
    shardId: row.shardId,
    maxAttempts: row.maxAttempts,
    payload: row.payload,
    activeKey: row.activeKey,
  });
}
