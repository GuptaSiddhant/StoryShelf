/**
 * Exhausted-job recovery of the database queue (ADR 0040, decision 2). A job whose last attempt lost
 * its lease has no holder left to record the failure, so the host's `onExhausted` hook writes it. The
 * hook runs inside the queue's own lease and redelivery model, not in memory:
 *
 * - each hook run is an attempt row numbered after the allowed attempts (`<jobId>:<maxAttempts + n>`),
 *   claimed by the same unique-key insert, so one instance runs it and a stale one writes nothing;
 * - the job row is `exhausting` and its `attempt` counts the runs, so the bound is durable;
 * - a run that throws, or whose instance dies, leaves its attempt row running: when the lease ends,
 *   any instance claims the next run. The lease is the backoff;
 * - after {@link MAX_HOOK_RUNS} runs the job fails anyway and `onAbandoned` raises the alert.
 */
import { attemptRowId, isTerminalJob } from "../../models/capture-job.ts";
import type { CaptureJobRow } from "../../schema/capture-job.ts";
import { isoAt } from "./clock.ts";
import { toDatabaseJob } from "./codec.ts";
import { finishJob, notifyEnded, startSuccessor } from "./single-flight.ts";
import type { QueueRuntime } from "./types.ts";

/** Error recorded on a job whose last allowed attempt lost its lease. */
export const LEASE_EXHAUSTED_ERROR = "lease expired on the final attempt";

/** Most runs of the exhausted-job hook, across instances, before the job fails regardless. */
export const MAX_HOOK_RUNS = 5;

/**
 * The final attempt lost its lease (`made` attempts exist, `stale` is the expired one). If the late
 * holder finished after all, its `done` wins.
 */
export async function exhaust(
  rt: QueueRuntime,
  job: CaptureJobRow,
  stale: CaptureJobRow | null,
  made: number,
): Promise<void> {
  if (stale !== null && stale.attempt <= job.maxAttempts && (await isDone(rt, stale.id))) {
    await finishJob(rt, job, "done");
    return;
  }
  if (rt.onExhausted === undefined) {
    await expire(rt, stale);
    await finishJob(rt, job, "failed", LEASE_EXHAUSTED_ERROR);
    rt.logger?.warn({ jobId: job.jobId, attempts: job.attempt }, "job failed: lease exhausted");
    return;
  }
  await claimHookRun(rt, job, stale, made + 1);
}

async function isDone(rt: QueueRuntime, id: string): Promise<boolean> {
  return (await rt.model.get(id))?.status === "done";
}

/** Mark an expired attempt row `expired`: it leaves the poll's range, and its holder sees `lost`. */
async function expire(rt: QueueRuntime, stale: CaptureJobRow | null): Promise<void> {
  if (stale !== null) {
    await rt.model.finishAttempt(stale.id, "expired", isoAt(rt));
  }
}

/** Insert hook run `run`'s attempt row; the winner replaces the expired run and does the work. */
async function claimHookRun(
  rt: QueueRuntime,
  job: CaptureJobRow,
  stale: CaptureJobRow | null,
  run: number,
): Promise<void> {
  const leaseUntil = isoAt(rt, rt.leaseMs);
  if (!(await rt.model.claim({ job, attempt: run, owner: rt.owner, leaseUntil }, isoAt(rt)))) {
    await followDeadClaimer(rt, job, stale, run);
    return;
  }
  await expire(rt, stale);
  const fresh = await rt.model.get(job.jobId);
  if (fresh === null || isTerminalJob(fresh)) {
    // Finished by a late holder, or cancelled, between the probe and the insert.
    await rt.model.finishAttempt(attemptRowId(job.jobId, run), "expired", isoAt(rt));
    return;
  }
  await runHook(rt, fresh, run);
}

/**
 * Another instance holds run `run`. Normally it replaces the expired run at once. If it died before
 * doing so, its own lease decides: once that ended, the run is replaced like any expired one, so the
 * old row cannot sit at the head of the poll losing every claim.
 */
async function followDeadClaimer(
  rt: QueueRuntime,
  job: CaptureJobRow,
  stale: CaptureJobRow | null,
  run: number,
): Promise<void> {
  const dead = await rt.model.expiredAttempt(attemptRowId(job.jobId, run), isoAt(rt));
  if (dead !== null) {
    await expire(rt, stale);
    await claimHookRun(rt, job, dead, run + 1);
  }
}

/** The claim won: cancel, give up, or run the hook for run number `run - maxAttempts`. */
async function runHook(rt: QueueRuntime, job: CaptureJobRow, run: number): Promise<void> {
  if (job.cancelRequestedAt !== null) {
    await settle(rt, job.jobId, run, "cancelled");
  } else if (run - job.maxAttempts > MAX_HOOK_RUNS) {
    await abandon(rt, job, run);
  } else if (await rt.model.markExhausting(job.jobId, run, LEASE_EXHAUSTED_ERROR, isoAt(rt))) {
    if (await callHook(rt, job, run - job.maxAttempts)) {
      await settle(rt, job.jobId, run, "failed");
    }
  } else {
    // A late holder finished the job after the check: leave its outcome and skip the hook.
    await rt.model.finishAttempt(attemptRowId(job.jobId, run), "expired", isoAt(rt));
  }
}

/** Call the host's hook; false when it threw (the run's lease then paces the next one). */
async function callHook(rt: QueueRuntime, job: CaptureJobRow, index: number): Promise<boolean> {
  const fields = { jobId: job.jobId, hookRun: index, hookRuns: MAX_HOOK_RUNS };
  rt.logger?.warn(fields, "job exhausted");
  try {
    await rt.onExhausted?.(toDatabaseJob(job, job.maxAttempts, rt.leaseMs), LEASE_EXHAUSTED_ERROR);
    return true;
  } catch (error) {
    // The attempt row stays running: its lease ends and another run follows.
    rt.logger?.error({ err: error, ...fields }, "exhausted-job hook failed");
    return false;
  }
}

/** Every hook run failed: fail the job anyway and tell an operator, once, that the build may be stuck. */
async function abandon(rt: QueueRuntime, job: CaptureJobRow, run: number): Promise<void> {
  rt.logger?.error(
    { jobId: job.jobId, buildId: job.buildId, hookRuns: MAX_HOOK_RUNS },
    "exhausted-job hook gave up; the build may be left unfinished",
  );
  try {
    await rt.onAbandoned?.(toDatabaseJob(job, job.maxAttempts, rt.leaseMs), LEASE_EXHAUSTED_ERROR);
  } catch (error) {
    rt.logger?.error({ err: error, jobId: job.jobId }, "exhausted-job alert failed");
  }
  await settle(rt, job.jobId, run, "failed");
}

/**
 * End the job and the hook run. Only the holder of a run that is still `running` writes: one whose
 * lease was taken over writes nothing, and a job a late holder already finished keeps its outcome.
 */
async function settle(
  rt: QueueRuntime,
  jobId: string,
  run: number,
  status: "failed" | "cancelled",
): Promise<void> {
  const own = attemptRowId(jobId, run);
  if ((await rt.model.get(own))?.status !== "running") {
    return;
  }
  const current = await rt.model.get(jobId);
  if (current !== null && !isTerminalJob(current)) {
    const outcome = current.cancelRequestedAt === null ? status : "cancelled";
    // Conditional: a `done` that lands after the read above is not overwritten.
    await rt.model.finishOpenJob(jobId, outcome, isoAt(rt), LEASE_EXHAUSTED_ERROR);
    await successorAfter(rt, current, outcome);
  }
  await rt.model.finishAttempt(own, "done", isoAt(rt));
  await endedAfter(rt, jobId);
}

/**
 * A job that failed here gives a request that came in while it ran its successor, as any failed job
 * does. Only when this write was the one that ended it (a late `done` finished it its own way), and
 * never after a cancel.
 */
async function successorAfter(
  rt: QueueRuntime,
  row: CaptureJobRow,
  outcome: "failed" | "cancelled",
): Promise<void> {
  if (outcome === "failed" && (await rt.model.get(row.jobId))?.status === "failed") {
    await startSuccessor(rt, row);
  }
}

/** The host hears of the end once the hook run's own row is written too, and only if the job did end. */
async function endedAfter(rt: QueueRuntime, jobId: string): Promise<void> {
  const row = await rt.model.get(jobId);
  if (row !== null && (row.status === "failed" || row.status === "done")) {
    await notifyEnded(rt, row);
  }
}
