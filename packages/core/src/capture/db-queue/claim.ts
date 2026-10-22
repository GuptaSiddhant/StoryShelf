/**
 * The claim algorithm of the database queue. A poll probes for the oldest candidate row (a queued
 * job whose `visibleAt` passed, or a running attempt whose lease ran out), then claims the job's
 * next attempt by inserting its row: the unique key lets exactly one instance win. The winner
 * retires the expired attempt it replaced and marks the job row running.
 */
import { attemptRowId, isTerminalJob } from "../../models/capture-job.ts";
import type { CaptureJobRow } from "../../schema/capture-job.ts";
import { isoAt } from "./clock.ts";
import { toDatabaseJob } from "./codec.ts";
import type { DatabaseJob, QueueRuntime } from "./types.ts";

/** Candidates tried per poll when other instances win the race for them. */
const MAX_CLAIM_TRIES = 3;

/** Error recorded on a job whose last allowed attempt lost its lease. */
export const LEASE_EXHAUSTED_ERROR = "lease expired on the final attempt";

/** Probe once and claim the job found; on a lost race, try the next candidate (a few times). */
export async function claimNext(rt: QueueRuntime): Promise<DatabaseJob | null> {
  for (let tries = 0; tries < MAX_CLAIM_TRIES; tries += 1) {
    // oxlint-disable-next-line no-await-in-loop -- one candidate at a time, in order
    const candidate = await rt.model.nextCandidate(rt.kinds, isoAt(rt));
    if (candidate === null) {
      return null;
    }
    // oxlint-disable-next-line no-await-in-loop -- see above
    const job = await claimCandidate(rt, candidate);
    if (job !== null) {
      return job;
    }
  }
  return null;
}

/** Claim the job behind a candidate row; null when it is gone, over, exhausted or lost to a race. */
export async function claimCandidate(
  rt: QueueRuntime,
  candidate: CaptureJobRow,
): Promise<DatabaseJob | null> {
  if (candidate.entry === "job" && candidate.status !== "queued") {
    // A running job row put back in range by a late deferral (see `deferBehind`): not claimable.
    await rt.model.clearVisibility(candidate.id, isoAt(rt));
    return null;
  }
  const stale = candidate.entry === "attempt" ? candidate : null;
  const job = stale === null ? candidate : await rt.model.get(candidate.jobId);
  if (job === null || isTerminalJob(job) || (stale !== null && stale.attempt < job.attempt)) {
    // Nothing left to claim: the expired attempt is just cleaned out of the poll's range.
    await retire(rt, stale);
    return null;
  }
  return await claimNextAttempt(rt, job, stale);
}

/** Claim the attempt after the last one made, or fail the job when none is left. */
async function claimNextAttempt(
  rt: QueueRuntime,
  job: CaptureJobRow,
  stale: CaptureJobRow | null,
): Promise<DatabaseJob | null> {
  // An attempt row ahead of its job row belongs to a claimer that died before marking the job.
  const made = Math.max(job.attempt, stale?.attempt ?? 0);
  if (made >= job.maxAttempts) {
    await exhaust(rt, job, stale);
    return null;
  }
  return await claimAttempt(rt, job, made + 1, stale);
}

async function claimAttempt(
  rt: QueueRuntime,
  job: CaptureJobRow,
  attempt: number,
  stale: CaptureJobRow | null,
): Promise<DatabaseJob | null> {
  const leaseUntil = isoAt(rt, rt.leaseMs);
  const won = await rt.model.claim({ job, attempt, owner: rt.owner, leaseUntil }, isoAt(rt));
  if (!won) {
    return stale === null ? await afterLostRace(rt, job, attempt) : null;
  }
  const fresh = await rt.model.get(job.jobId);
  if (fresh === null || isTerminalJob(fresh)) {
    // Cancelled (or finished by a late holder) between the probe and the insert.
    await rt.model.finishAttempt(attemptRowId(job.jobId, attempt), "expired", isoAt(rt));
    return null;
  }
  return await takeOver(rt, fresh, attempt, stale);
}

/**
 * Another instance holds attempt `attempt` of a job whose row still reads queued. Usually that
 * winner is about to mark the job running. If it died before doing so, its attempt's lease decides:
 * once expired, the attempt is claimed like any expired one; until then the job row is moved
 * behind that lease, so it does not sit at the head of the queue losing every claim. Only
 * `visibleAt` is written, never the status, so a winner that finished meanwhile keeps its outcome.
 */
async function afterLostRace(
  rt: QueueRuntime,
  job: CaptureJobRow,
  attempt: number,
): Promise<DatabaseJob | null> {
  const id = attemptRowId(job.jobId, attempt);
  const expired = await rt.model.expiredAttempt(id, isoAt(rt));
  if (expired !== null) {
    return await claimCandidate(rt, expired);
  }
  await deferBehind(rt, job, await rt.model.get(id));
  return null;
}

async function deferBehind(
  rt: QueueRuntime,
  job: CaptureJobRow,
  holder: CaptureJobRow | null,
): Promise<void> {
  const current = await rt.model.get(job.jobId);
  if (holder?.visibleAt && current?.status === "queued" && current.attempt === job.attempt) {
    await rt.model.defer(job.jobId, holder.visibleAt, isoAt(rt));
  }
}

/** The claim won: retire the attempt it replaced and record the new one on the job row. */
async function takeOver(
  rt: QueueRuntime,
  job: CaptureJobRow,
  attempt: number,
  stale: CaptureJobRow | null,
): Promise<DatabaseJob> {
  await retire(rt, stale);
  await rt.model.markRunning(job.jobId, attempt, isoAt(rt));
  rt.logger?.debug({ jobId: job.jobId, attempt }, "job claimed");
  return toDatabaseJob(job, attempt, rt.leaseMs);
}

/** Mark an expired attempt row `expired`: it leaves the poll's range, and its holder sees `lost`. */
async function retire(rt: QueueRuntime, stale: CaptureJobRow | null): Promise<void> {
  if (stale !== null) {
    await rt.model.finishAttempt(stale.id, "expired", isoAt(rt));
  }
}

/**
 * The final attempt lost its lease: the job fails (one limit covers failed attempts and lost
 * leases). Idempotent, so two instances finding the same row write the same outcome. If the late
 * holder finished after all, its `done` wins.
 */
async function exhaust(
  rt: QueueRuntime,
  job: CaptureJobRow,
  stale: CaptureJobRow | null,
): Promise<void> {
  const now = isoAt(rt);
  if (stale !== null && (await rt.model.get(stale.id))?.status === "done") {
    await rt.model.finishJob(job.jobId, "done", now);
    return;
  }
  await retire(rt, stale);
  await rt.model.finishJob(job.jobId, "failed", now, LEASE_EXHAUSTED_ERROR);
  rt.logger?.warn({ jobId: job.jobId, attempts: job.attempt }, "job failed: lease exhausted");
}
