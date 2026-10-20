/**
 * The terminal path for a capture job the forked parent gave up on because the child kept dying on
 * it (ADR 0031 phase 3). The child never got to record the failure, so the parent writes it: the
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
import { postStatusesForBuild } from "./status-fanout.ts";

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
  job: { buildId: string; shard?: string | undefined },
  error: string,
): Promise<CrashFailureOutcome> {
  const outcome = job.shard
    ? await failShard(deps, job.buildId, job.shard, error)
    : await failBuild(deps, job.buildId, error);
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
  error: string,
): Promise<CrashFailureOutcome> {
  const loaded = await load(deps, buildId);
  if (!loaded || (loaded.build.status !== "capturing" && loaded.build.status !== "pending")) {
    return "skipped";
  }
  await closeOpenAttempts(deps, buildId, error);
  await new BuildModel(deps.db, deps.tables).setStatus(buildId, "failed");
  await postTerminal(deps, loaded, "failure");
  return "failed";
}

async function failShard(
  deps: DispatchDeps,
  buildId: string,
  shardId: string,
  error: string,
): Promise<CrashFailureOutcome> {
  await new CaptureShardModel(deps.db).fail(shardId, error);
  const loaded = await load(deps, buildId);
  if (loaded?.build.status !== "capturing") {
    return "skipped";
  }
  const summary = await reduceBuild({ options: deps.jobOptions, ...loaded });
  if (!summary) {
    return "shard-failed";
  }
  await closeFinalized(deps, loaded, summary, error);
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
  const finished = await new BuildModel(deps.db, deps.tables).get(loaded.build.id);
  const state = terminalState(finished?.status);
  if (state) {
    await postTerminal(deps, loaded, state);
  }
}

/** The check state for a finished build; a build waiting for review keeps its pending status. */
function terminalState(status: string | undefined): "success" | "failure" | null {
  if (status === "approved") {
    return "success";
  }
  return status === "failed" || status === "rejected" ? "failure" : null;
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
): Promise<void> {
  const attempts = new CaptureAttemptModel(deps.db, deps.tables);
  const open = (await attempts.listByBuild(buildId)).filter(
    (attempt) => attempt.status === "queued" || attempt.status === "running",
  );
  await Promise.all(
    open.map(async (attempt) => await attempts.markFinished(attempt.id, "failed", error)),
  );
}

async function postTerminal(
  deps: DispatchDeps,
  { build, project }: { build: Build; project: Project },
  status: "success" | "failure",
): Promise<void> {
  await postStatusesForBuild({
    db: deps.db,
    tables: deps.tables,
    project,
    sha: build.gitSha,
    status,
    url: `/projects/${project.slug}/builds/${build.id}`,
    providers: deps.gitHosts,
    secret: deps.secret,
    logger: deps.logger,
  }).catch((error: unknown) => {
    deps.logger.error({ err: error, buildId: build.id }, "failed to post terminal status");
  });
}
