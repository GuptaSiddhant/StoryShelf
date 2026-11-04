/**
 * The terminal path for a capture job the forked parent gave up on because the child kept dying on
 * it (ADR 0005 phase 3). The child never got to record the failure, so the parent writes it: the
 * build fails, or, for a shard, the shard row fails and the build is reduced like any other end.
 */
import { BuildModel } from "../models/build.ts";
import { CaptureAttemptModel } from "../models/capture-attempt.ts";
import { CaptureShardModel } from "../models/capture-shard.ts";
import { ProjectModel } from "../models/project.ts";
import type { Build } from "../schema/build.ts";
import type { Project } from "../schema/project.ts";
import type { DispatchDeps } from "./dispatch.ts";
import { reduceBuild, type FinalSummary } from "./shards/reduce.ts";

/** What {@link failCrashedCapture} did. */
export type CrashFailureOutcome =
  /** The build was failed. */
  | "failed"
  /** The shard was failed; other shards are still open, and the last of them finishes the build. */
  | "shard-failed"
  /** The shard was the last one open: the build was finalized (failed, with this shard's stories). */
  | "finalized"
  /** The build had already ended (or is gone): nothing to do. */
  | "skipped";

/**
 * Fail a capture job that crashed its worker past its retries. Safe to call for a build that has
 * since ended: it is left alone.
 */
export async function failCrashedCapture(
  deps: DispatchDeps,
  job: { buildId: string; shard?: string | undefined; jobId?: string | undefined },
  error: string,
): Promise<CrashFailureOutcome> {
  const outcome = job.shard
    ? await failShard(deps, job.buildId, job.shard, error)
    : await failBuild(deps, job.buildId, job.jobId, error);
  if (outcome !== "skipped") {
    deps.logger.error(
      { buildId: job.buildId, shard: job.shard, outcome, error },
      "capture kept crashing its worker; failed it",
    );
  }
  return outcome;
}

async function failBuild(
  deps: DispatchDeps,
  buildId: string,
  jobId: string | undefined,
  error: string,
): Promise<CrashFailureOutcome> {
  if (jobId !== undefined) {
    return await failOwnedBuild(deps, buildId, jobId, error);
  }
  const loaded = await load(deps, buildId);
  if (!loaded || (loaded.build.status !== "capturing" && loaded.build.status !== "pending")) {
    return "skipped";
  }
  await closeOpenAttempts(deps, buildId, error);
  await new BuildModel(deps.db, deps.tables).setStatus(buildId, "failed");
  await deps.buildState.request(buildId);
  return "failed";
}

/**
 * The build fails only while this job's run owns it (`builds.capture_job_id`). A hook that runs
 * after the build was reset and queued again names a job the build no longer points at, so the
 * newer run is left alone; a build no run owns (null) is never failed here.
 */
async function failOwnedBuild(
  deps: DispatchDeps,
  buildId: string,
  jobId: string,
  error: string,
): Promise<CrashFailureOutcome> {
  const { applied, build } = await new BuildModel(deps.db, deps.tables).failIfOwnedBy(
    buildId,
    jobId,
  );
  // A retry of a hook that failed part-way: this job already failed the build, so finish the cleanup.
  const retry = !applied && build?.status === "failed" && build.captureJobId === jobId;
  if (!applied && !retry) {
    deps.logger.info(
      { buildId, jobId, ownerJobId: build?.captureJobId ?? null, status: build?.status },
      "crashed capture no longer owns its build; left it alone",
    );
    return "skipped";
  }
  const closed = await closeRunAttempts(deps, buildId, build, error);
  if (retry && closed === 0) {
    return "skipped"; // nothing was left to do: the first pass finished
  }
  await deps.buildState.request(buildId);
  return "failed";
}

/** Close the attempts that began before the build was failed: a newer run's are left open. */
async function closeRunAttempts(
  deps: DispatchDeps,
  buildId: string,
  failed: Build | null,
  error: string,
): Promise<number> {
  return await closeOpenAttempts(deps, buildId, error, Date.parse(failed?.updatedAt ?? ""));
}

async function failShard(
  deps: DispatchDeps,
  buildId: string,
  shardId: string,
  error: string,
): Promise<CrashFailureOutcome> {
  const shards = new CaptureShardModel(deps.db);
  if (!(await shards.get(shardId))) {
    return "skipped"; // a retry cleared the plan's rows: this hook belongs to a run that is over
  }
  await shards.fail(shardId, error);
  const loaded = await load(deps, buildId);
  if (!loaded) {
    return "skipped";
  }
  if (loaded.build.status !== "capturing") {
    return await closeEndedAttempt(deps, shards, { buildId, shardId }, error);
  }
  return await reduceAfterFailure(deps, loaded, error);
}

/** The build is still capturing: the failed shard may have been its last open one. */
async function reduceAfterFailure(
  deps: DispatchDeps,
  loaded: { build: Build; project: Project },
  error: string,
): Promise<CrashFailureOutcome> {
  const summary = await reduceBuild({ options: deps.jobOptions, ...loaded });
  if (!summary) {
    return "shard-failed";
  }
  await closeFinalized(deps, loaded, summary, error);
  return "finalized";
}

/**
 * The build left `capturing` already: an earlier pass of this hook finalized it (or the last
 * sibling did) but may not have closed the attempt, and a retry must not leave it open forever. The
 * plan's attempt is closed if it is still open, and `reduceBuild` is never run again. The shard row
 * fences the run: a retry or recovery clears the plan's rows and writes new ones, so a hook that
 * arrives after that finds its shard gone and leaves the newer run's attempt alone.
 */
async function closeEndedAttempt(
  deps: DispatchDeps,
  shards: CaptureShardModel,
  target: { buildId: string; shardId: string },
  error: string,
): Promise<CrashFailureOutcome> {
  const plan = (await shards.get(target.shardId)) ? await shards.plan(target.buildId) : null;
  if (!plan?.attemptId) {
    return "skipped";
  }
  const attempts = new CaptureAttemptModel(deps.db, deps.tables);
  const open = (await attempts.listByBuild(target.buildId)).find(
    (attempt) =>
      attempt.id === plan.attemptId &&
      (attempt.status === "queued" || attempt.status === "running"),
  );
  if (!open) {
    return "skipped"; // nothing was left to close: the first pass finished
  }
  await attempts.markFinished(open.id, "failed", error);
  await deps.buildState.request(target.buildId);
  return "finalized";
}

/** The crashed shard was the last one: close the plan's attempt and report the build's end. */
async function closeFinalized(
  deps: DispatchDeps,
  loaded: { build: Build; project: Project },
  summary: FinalSummary,
  error: string,
): Promise<void> {
  if (summary.attemptId) {
    await new CaptureAttemptModel(deps.db, deps.tables).markFinished(
      summary.attemptId,
      "failed",
      error,
      summary,
    );
  }
  await deps.buildState.request(loaded.build.id);
}

async function load(
  deps: DispatchDeps,
  buildId: string,
): Promise<{ build: Build; project: Project } | null> {
  const build = await new BuildModel(deps.db, deps.tables).get(buildId);
  const project = build ? await new ProjectModel(deps.db, deps.tables).get(build.projectId) : null;
  return build && project ? { build, project } : null;
}

async function closeOpenAttempts(
  deps: DispatchDeps,
  buildId: string,
  error: string,
  startedBefore = Number.POSITIVE_INFINITY,
): Promise<number> {
  const attempts = new CaptureAttemptModel(deps.db, deps.tables);
  const open = (await attempts.listByBuild(buildId)).filter(
    (attempt) =>
      (attempt.status === "queued" || attempt.status === "running") &&
      Date.parse(attempt.createdAt) <= startedBefore,
  );
  await Promise.all(
    open.map(async (attempt) => await attempts.markFinished(attempt.id, "failed", error)),
  );
  return open.length;
}
