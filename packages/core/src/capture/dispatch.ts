import type { DatabaseAdapter } from "../adapters/database.ts";
import type { Logger } from "../logger.ts";
import { BuildModel, type BuildTables } from "../models/build.ts";
import {
  CaptureAttemptModel,
  emitAttemptLog,
  type AttemptLogRecorder,
  type CaptureAttemptTables,
} from "../models/capture-attempt.ts";
import { CaptureLogModel, type CaptureLogTables } from "../models/capture-log.ts";
import { CaptureShardModel } from "../models/capture-shard.ts";
import { ProjectModel, type ProjectTables } from "../models/project.ts";
import type { Build } from "../schema/build.ts";
import type { CaptureAttempt } from "../schema/capture-attempt.ts";
import type { Project } from "../schema/project.ts";
import type { BuildStatePublisher } from "./build-state/types.ts";
import type { JobLease } from "./job-lease.ts";
import { executeCaptureJob, type CaptureJobOptions, type CaptureSummary } from "./orchestrator.ts";
import { leaseProgress, type CaptureProgress } from "./progress.ts";
import { executeCaptureShard } from "./shards/execute.ts";
import type { FinalSummary } from "./shards/reduce.ts";
import { hasApprovedBuildForSha } from "./skip-checks.ts";

/** Build the queue's job runner: post pending, apply skip rules, capture, report. */
export function createDispatchJob(
  deps: DispatchDeps,
): (job: CaptureDispatchJob, lease?: JobLease) => Promise<void> {
  return async (job: CaptureDispatchJob, lease?: JobLease): Promise<void> => {
    await (job.shard
      ? runShardJob(deps, { ...job, shard: job.shard }, lease)
      : runBuildJob(deps, job, lease));
  };
}

/** The build's own job: post pending, apply skip rules, capture (or plan), report. */
async function runBuildJob(
  deps: DispatchDeps,
  job: CaptureDispatchJob,
  lease?: JobLease,
): Promise<void> {
  const target = await loadJobTarget(deps, job);
  if (!target) {
    return;
  }
  await deps.buildState.request(job.buildId);
  const { attempt, recordLog } = await beginAttempt(
    deps,
    target.project,
    target.build,
    job.reqId,
    lease,
  );
  const ctx: JobContext = {
    deps,
    build: target.build,
    project: target.project,
    attempt,
    recordLog,
    progress: leaseProgress(lease),
  };
  if (await maybeSkipDuplicate(ctx)) {
    return;
  }
  await runAndReport(ctx, job);
}

/** Table handles required by dispatch. */
export type DispatchTables = BuildTables & ProjectTables & CaptureAttemptTables & CaptureLogTables;

/** Dependencies for building the capture queue's job runner. */
export interface DispatchDeps {
  db: DatabaseAdapter;
  tables: DispatchTables;
  jobOptions: CaptureJobOptions;
  /** Shows a build's current state on its git channels; called at every transition. */
  buildState: BuildStatePublisher;
  logger: Logger;
  /** Redeliveries the queue allows a failing job; a shard's last try is its final word. */
  maxRetries?: number | undefined;
}

/** A queued capture job. */
export interface CaptureDispatchJob {
  buildId: string;
  /** A `capture_shards` row to render; absent for the build's own (plan or whole-build) job. */
  shard?: string | undefined;
  /** Times the queue has already delivered this job and seen it fail. */
  attempts?: number | undefined;
  reqId?: string;
  /** W3C `traceparent` continuing the enqueueing request's trace. */
  traceparent?: string;
}

interface JobContext {
  deps: DispatchDeps;
  build: Build;
  project: Project;
  attempt: CaptureAttempt;
  recordLog: AttemptLogRecorder;
  progress: CaptureProgress | undefined;
}

/** Open a new attempt row for this run and return its log recorder. */
async function beginAttempt(
  deps: DispatchDeps,
  project: Project,
  build: Build,
  reqId: string | undefined,
  lease?: JobLease,
): Promise<{ attempt: CaptureAttempt; recordLog: AttemptLogRecorder }> {
  const attempts = new CaptureAttemptModel(deps.db, deps.tables);
  const logs = new CaptureLogModel(deps.db, deps.tables);
  const attempt = await attempts.startAttempt(project.id, build.id, reqId);
  // Every attempt-log line (stages, render progress, runner output) counts as progress.
  const recordLog: AttemptLogRecorder = async (level, message, fields) => {
    lease?.touch();
    await logs.append(project.id, build.id, attempt.id, level, message, fields);
  };
  await emitAttemptLog(recordLog, deps.logger, "info", "capture queued", {
    buildId: build.id,
    attemptNo: attempt.attemptNo,
  });
  return { attempt, recordLog };
}

/** Close the attempt row with its terminal status, counts, and error. */
async function finishAttempt(
  ctx: JobContext,
  status: "completed" | "failed" | "cancelled",
  error?: string,
  counts?: { storyCount: number; failedCount: number },
): Promise<void> {
  const { deps, attempt } = ctx;
  await new CaptureAttemptModel(deps.db, deps.tables).markFinished(
    attempt.id,
    status,
    error,
    counts,
  );
  await emitAttemptLog(
    ctx.recordLog,
    deps.logger,
    status === "failed" ? "error" : "info",
    `capture ${status}`,
    { attemptNo: attempt.attemptNo },
  );
}

/** Full error text for an attempt row (message plus stack when available). */
function errorText(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.stack ?? reason.message;
  }
  return String(reason);
}

async function approveWithoutCapture(ctx: JobContext, reason: string): Promise<void> {
  const { deps, build } = ctx;
  deps.logger.info({ buildId: build.id, sha: build.gitSha, branch: build.gitBranch }, reason);
  await emitAttemptLog(ctx.recordLog, deps.logger, "info", reason, {
    sha: build.gitSha,
    branch: build.gitBranch,
  });
  await finishAttempt(ctx, "completed");
  await new BuildModel(deps.db, deps.tables).setStatus(build.id, "approved").catch(() => {}); // Intentionally empty — fire-and-forget
  await deps.buildState.request(build.id);
}

async function maybeSkipDuplicate(ctx: JobContext): Promise<boolean> {
  const { deps, build, project } = ctx;
  const dup = await hasApprovedBuildForSha(
    deps.db,
    deps.tables,
    project.id,
    build.gitSha,
    build.id,
  );
  if (dup) {
    await approveWithoutCapture(ctx, "skipping capture — duplicate sha already approved");
    return true;
  }
  return false;
}

/** A sharded build's attempt stays open: the worker that finishes the last shard closes it. */
async function finishUnlessSharded(ctx: JobContext, summary: CaptureSummary): Promise<void> {
  if (summary.shards) {
    await emitAttemptLog(ctx.recordLog, ctx.deps.logger, "info", "capture sharded", {
      shards: summary.shards,
    });
    return;
  }
  await finishAttempt(ctx, "completed", undefined, summary);
  await ctx.deps.buildState.request(ctx.build.id);
}

async function runAndReport(ctx: JobContext, job: CaptureDispatchJob): Promise<void> {
  const { deps, build } = ctx;
  await new CaptureAttemptModel(deps.db, deps.tables).markRunning(ctx.attempt.id);
  await emitAttemptLog(ctx.recordLog, deps.logger, "info", "capture started", {
    buildId: build.id,
    attemptNo: ctx.attempt.attemptNo,
  });
  try {
    const summary = await executeCaptureJob(
      {
        buildId: job.buildId,
        reqId: job.reqId,
        traceparent: job.traceparent,
        attempt: {
          id: ctx.attempt.id,
          attemptNo: ctx.attempt.attemptNo,
          projectId: ctx.project.id,
        },
        recordLog: ctx.recordLog,
        progress: ctx.progress,
      },
      deps.jobOptions,
    );
    await finishUnlessSharded(ctx, summary);
  } catch (error: unknown) {
    await finishAttempt(ctx, "failed", errorText(error));
    await deps.buildState.request(build.id);
    throw error;
  }
}

/** Load the build + project for a job, running orphan jobs directly. */
async function loadJobTarget(
  deps: DispatchDeps,
  job: CaptureDispatchJob,
): Promise<{ build: Build; project: Project } | null> {
  const build = await new BuildModel(deps.db, deps.tables).get(job.buildId);
  const project = build ? await new ProjectModel(deps.db, deps.tables).get(build.projectId) : null;
  if (!build || !project) {
    await executeCaptureJob(
      { buildId: job.buildId, reqId: job.reqId, traceparent: job.traceparent },
      deps.jobOptions,
    );
    return null;
  }
  return { build, project };
}

/**
 * Run one render shard. Only the run that finalized the build closes the plan's attempt and posts
 * the terminal status, whether its shard succeeded or failed; every other run leaves them alone.
 */
async function runShardJob(
  deps: DispatchDeps,
  job: CaptureDispatchJob & { shard: string },
  lease?: JobLease,
): Promise<void> {
  const final = (job.attempts ?? 0) >= (deps.maxRetries ?? 0);
  await executeCaptureShard(
    {
      buildId: job.buildId,
      shard: job.shard,
      reqId: job.reqId,
      final,
      progress: leaseProgress(lease),
      onFinalized: async (summary, error) => {
        await closeShardedBuild(deps, job.buildId, summary, error);
      },
    },
    deps.jobOptions,
  );
}

/** End the plan's attempt with the finalizer's counts and report the build's terminal status. */
async function closeShardedBuild(
  deps: DispatchDeps,
  buildId: string,
  summary: FinalSummary,
  error?: unknown,
): Promise<void> {
  const loaded = await loadClosing(deps, buildId);
  if (!loaded) {
    return;
  }
  const failure = error === undefined ? summary.error : errorText(error);
  const failed = failure !== undefined || summary.buildStatus === "failed";
  const attemptId = summary.attemptId ?? (await planAttemptId(deps, buildId));
  if (attemptId) {
    await new CaptureAttemptModel(deps.db, deps.tables)
      .markFinished(attemptId, failed ? "failed" : "completed", failure, summary)
      .catch((closeError: unknown) => {
        deps.logger.error({ err: closeError }, "failed to close attempt");
      });
  }
  await deps.buildState.request(buildId);
}

async function planAttemptId(deps: DispatchDeps, buildId: string): Promise<string | null> {
  const plan = await new CaptureShardModel(deps.db).plan(buildId);
  return plan?.attemptId ?? null;
}

async function loadClosing(
  deps: DispatchDeps,
  buildId: string,
): Promise<{ build: Build; project: Project } | null> {
  const build = await new BuildModel(deps.db, deps.tables).get(buildId);
  const project = build ? await new ProjectModel(deps.db, deps.tables).get(build.projectId) : null;
  return build && project ? { build, project } : null;
}
