import type { DatabaseAdapter } from "../adapters/database.ts";
import type { GitHostProvider } from "../adapters/git-host/index.ts";
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
import type { StatusConfigTables } from "../models/status-config.ts";
import type { Build } from "../schema/build.ts";
import type { CaptureAttempt } from "../schema/capture-attempt.ts";
import type { Project } from "../schema/project.ts";
import type { SecretInput } from "../utils/encrypt.ts";
import type { JobLease } from "./job-lease.ts";
import { executeCaptureJob, type CaptureJobOptions, type CaptureSummary } from "./orchestrator.ts";
import { executeCaptureShard } from "./shards/execute.ts";
import type { FinalSummary } from "./shards/reduce.ts";
import { hasApprovedBuildForSha, isAlreadyMerged } from "./skip-checks.ts";
import { postStatusesForBuild } from "./status-fanout.ts";

/** Build the queue's job runner: post pending, apply skip rules, capture, report. */
export function createDispatchJob(
  deps: DispatchDeps,
): (job: CaptureDispatchJob, lease?: JobLease) => Promise<void> {
  return async (job: CaptureDispatchJob, lease?: JobLease): Promise<void> => {
    await (job.shard
      ? runShardJob(deps, { ...job, shard: job.shard })
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
  const pendingUrl = `/projects/${target.project.slug}/builds/${job.buildId}`;
  await postPending(deps, target.project, pendingUrl, target.build.gitSha);
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
    pendingUrl,
    attempt,
    recordLog,
  };
  if ((await maybeSkipMerged(ctx)) || (await maybeSkipDuplicate(ctx))) {
    return;
  }
  await runAndReport(ctx, job);
}

/** Table handles required by dispatch. */
export type DispatchTables = BuildTables &
  ProjectTables &
  StatusConfigTables &
  CaptureAttemptTables &
  CaptureLogTables;

/** Dependencies for building the capture queue's job runner. */
export interface DispatchDeps {
  db: DatabaseAdapter;
  tables: DispatchTables;
  jobOptions: CaptureJobOptions;
  gitHosts: GitHostProvider[];
  secret: SecretInput;
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
  pendingUrl: string;
  attempt: CaptureAttempt;
  recordLog: AttemptLogRecorder;
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

async function postPending(
  deps: DispatchDeps,
  project: Project,
  url: string,
  sha: string,
): Promise<void> {
  await postStatusesForBuild({
    db: deps.db,
    tables: deps.tables,
    project,
    sha,
    status: "pending",
    url,
    providers: deps.gitHosts,
    secret: deps.secret,
    logger: deps.logger,
  }).catch((error: unknown) => {
    deps.logger.error({ err: error }, "failed to post pending status");
  });
}

async function postTerminal(
  deps: DispatchDeps,
  project: Project,
  url: string,
  sha: string,
  status: "success" | "failure",
): Promise<void> {
  await postStatusesForBuild({
    db: deps.db,
    tables: deps.tables,
    project,
    sha,
    status,
    url,
    providers: deps.gitHosts,
    secret: deps.secret,
    logger: deps.logger,
  }).catch((error: unknown) => {
    deps.logger.error({ err: error }, "failed to post terminal status");
  });
}

async function approveWithoutCapture(ctx: JobContext, reason: string): Promise<void> {
  const { deps, build, project, pendingUrl } = ctx;
  deps.logger.info({ buildId: build.id, sha: build.gitSha, branch: build.gitBranch }, reason);
  await emitAttemptLog(ctx.recordLog, deps.logger, "info", reason, {
    sha: build.gitSha,
    branch: build.gitBranch,
  });
  await finishAttempt(ctx, "completed");
  await new BuildModel(deps.db, deps.tables).setStatus(build.id, "approved").catch(() => {}); // Intentionally empty — fire-and-forget
  await postTerminal(deps, project, pendingUrl, build.gitSha, "success").catch(() => {}); // Intentionally empty — fire-and-forget
}

async function maybeSkipMerged(ctx: JobContext): Promise<boolean> {
  const { deps, build, project } = ctx;
  if (build.isDefault) {
    return false;
  }
  const merged = await isAlreadyMerged({
    providers: deps.gitHosts,
    sha: build.gitSha,
    branch: build.gitBranch,
    secret: deps.secret,
    db: deps.db,
    tables: deps.tables,
    projectId: project.id,
    logger: deps.logger,
  }).catch(() => false);
  if (merged) {
    await approveWithoutCapture(ctx, "skipping capture — already merged");
    return true;
  }
  return false;
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

/** Map a terminal build status to its check-run state. */
function terminalState(status: string | undefined): "success" | "failure" | null {
  if (status === "approved") {
    return "success";
  }
  if (status === "rejected" || status === "failed") {
    return "failure";
  }
  return null;
}

/** Post the terminal status for a finished capture. */
async function reportTerminalStatus(
  ctx: Pick<JobContext, "deps" | "build" | "project" | "pendingUrl">,
  buildId: string,
): Promise<void> {
  const { deps, build, project, pendingUrl } = ctx;
  const updated = await new BuildModel(deps.db, deps.tables).get(buildId);
  const terminal = terminalState(updated?.status);
  if (terminal) {
    await postTerminal(deps, project, pendingUrl, build.gitSha, terminal);
  }
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
  await reportTerminalStatus(ctx, ctx.build.id);
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
      },
      deps.jobOptions,
    );
    await finishUnlessSharded(ctx, summary);
  } catch (error: unknown) {
    await finishAttempt(ctx, "failed", errorText(error));
    await postStatusesForBuild({
      db: deps.db,
      tables: deps.tables,
      project: ctx.project,
      sha: build.gitSha,
      status: "failure",
      url: ctx.pendingUrl,
      providers: deps.gitHosts,
      secret: deps.secret,
      logger: deps.logger,
    }).catch(() => {
      // Ignore: status post failure already logged
    });
    throw error;
  }
}

/** Load the build + project for a job, running orphan jobs directly. */
async function loadJobTarget(
  deps: DispatchDeps,
  job: CaptureDispatchJob,
): Promise<{ build: Build; project: Project } | null> {
  const builds = new BuildModel(deps.db, deps.tables);
  const build = await builds.get(job.buildId);
  if (!build) {
    await executeCaptureJob(
      { buildId: job.buildId, reqId: job.reqId, traceparent: job.traceparent },
      deps.jobOptions,
    );
    return null;
  }
  const project = await new ProjectModel(deps.db, deps.tables).get(build.projectId);
  if (!project) {
    await executeCaptureJob(
      { buildId: job.buildId, reqId: job.reqId, traceparent: job.traceparent },
      deps.jobOptions,
    );
    return null;
  }
  return { build, project };
}

/** Run one render shard; the worker that finishes the last one closes the build's attempt. */
async function runShardJob(
  deps: DispatchDeps,
  job: CaptureDispatchJob & { shard: string },
): Promise<void> {
  const final = (job.attempts ?? 0) >= (deps.maxRetries ?? 0);
  try {
    const outcome = await executeCaptureShard(
      { buildId: job.buildId, shard: job.shard, reqId: job.reqId, final },
      deps.jobOptions,
    );
    if (outcome.status === "rendered" && outcome.finalized) {
      await closeShardedBuild(deps, job.buildId, outcome.summary);
    }
  } catch (error: unknown) {
    if (final) {
      await closeShardedBuild(deps, job.buildId, null, errorText(error));
    }
    throw error;
  }
}

/** End the plan's attempt and report the terminal status once the build's shards are all in. */
async function closeShardedBuild(
  deps: DispatchDeps,
  buildId: string,
  summary: FinalSummary | null,
  failure?: string,
): Promise<void> {
  const loaded = await loadClosing(deps, buildId);
  // A failed shard ends the build only if it was the last one open.
  if (!loaded || (summary === null && loaded.build.status === "capturing")) {
    return;
  }
  const failed = failure !== undefined || summary?.buildStatus === "failed";
  const attemptId = summary?.attemptId ?? (await planAttemptId(deps, buildId));
  if (attemptId) {
    await new CaptureAttemptModel(deps.db, deps.tables)
      .markFinished(attemptId, failed ? "failed" : "completed", failure, summary ?? undefined)
      .catch((error: unknown) => {
        deps.logger.error({ err: error }, "failed to close attempt");
      });
  }
  const pendingUrl = `/projects/${loaded.project.slug}/builds/${buildId}`;
  await reportTerminalStatus(
    { deps, build: loaded.build, project: loaded.project, pendingUrl },
    buildId,
  );
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
