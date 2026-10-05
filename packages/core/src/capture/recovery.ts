/**
 * Boot-time recovery for builds left in `capturing` by a server restart.
 *
 * Policy: requeue once. The interrupted attempt is closed with
 * {@link INTERRUPTED_ERROR}; a build with no earlier interrupted attempt goes back to `pending`
 * and is re-enqueued, otherwise it is marked `failed` for manual retry. A build is failed instead
 * when the run before the interrupted one was itself interrupted, so a crash loop stops after
 * one requeue while manual retries stay unrestricted. In-process queues only: remote queues redeliver on their own.
 */
import { eq, getTableColumns } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";
import { BuildModel } from "../models/build.ts";
import { CaptureAttemptModel } from "../models/capture-attempt.ts";
import { ProjectModel } from "../models/project.ts";
import type { Build } from "../schema/build.ts";
import type { DispatchDeps } from "./dispatch.ts";
import { postStatusesForBuild } from "./status-fanout.ts";

/** Error recorded on attempts that a restart cut short; also the requeue-once marker. */
export const INTERRUPTED_ERROR = "Interrupted by server restart";

/** Outcome of one recovery sweep. */
export interface RecoveryResult {
  requeued: string[];
  failed: string[];
}

/** Inputs for {@link recoverStuckCaptures}. */
export interface RecoveryDeps {
  deps: DispatchDeps;
  enqueue: (buildId: string) => Promise<void>;
}

/** Requeue (once) or fail every build still `capturing`; call once at boot, before serving jobs. */
export async function recoverStuckCaptures(recovery: RecoveryDeps): Promise<RecoveryResult> {
  const { deps } = recovery;
  const stuck = (await deps.db.list(deps.tables.builds, {
    where: eq(getTableColumns(deps.tables.builds)["status"] as unknown as SQLWrapper, "capturing"),
  })) as unknown as Build[];
  const outcomes = await Promise.all(
    stuck.map(async (build) => await recoverBuild(recovery, build)),
  );
  const result: RecoveryResult = {
    requeued: stuck.filter((_, index) => outcomes[index]).map((build) => build.id),
    failed: stuck.filter((_, index) => !outcomes[index]).map((build) => build.id),
  };
  if (stuck.length > 0) {
    deps.logger.warn(
      { requeued: result.requeued, failed: result.failed },
      "recovered builds interrupted by restart",
    );
  }
  return result;
}

/** Recover one build; returns true when it was requeued. */
async function recoverBuild(recovery: RecoveryDeps, build: Build): Promise<boolean> {
  const { deps } = recovery;
  const attempts = new CaptureAttemptModel(deps.db, deps.tables);
  const history = await attempts.listByBuild(build.id);
  const open = history.filter((a) => a.status === "queued" || a.status === "running");
  // Requeue-once: the run before the interrupted one was itself interrupted => crash loop.
  const lastClosed = history.findLast((a) => !open.includes(a));
  await Promise.all(
    open.map(async (a) => await attempts.markFinished(a.id, "failed", INTERRUPTED_ERROR)),
  );
  return lastClosed?.error === INTERRUPTED_ERROR
    ? await failInterrupted(deps, build)
    : await requeueInterrupted(recovery, build);
}

async function failInterrupted(deps: DispatchDeps, build: Build): Promise<false> {
  await new BuildModel(deps.db, deps.tables).setStatus(build.id, "failed");
  await postFailure(deps, build);
  deps.logger.error(
    { buildId: build.id },
    "build interrupted by restart again; marked failed for manual retry",
  );
  return false;
}

async function requeueInterrupted(recovery: RecoveryDeps, build: Build): Promise<true> {
  const { deps } = recovery;
  await new BuildModel(deps.db, deps.tables).setStatus(build.id, "pending");
  await recovery.enqueue(build.id);
  deps.logger.warn({ buildId: build.id }, "build interrupted by restart; requeued once");
  return true;
}

/** Replace the lingering pending git status with a failure. */
async function postFailure(deps: DispatchDeps, build: Build): Promise<void> {
  const project = await new ProjectModel(deps.db, deps.tables).get(build.projectId);
  if (!project) {
    return;
  }
  await postStatusesForBuild({
    db: deps.db,
    tables: deps.tables,
    project,
    sha: build.gitSha,
    status: "failure",
    url: `/projects/${project.slug}/builds/${build.id}`,
    providers: deps.gitHosts,
    secret: deps.secret,
    logger: deps.logger,
  }).catch((error: unknown) => {
    deps.logger.error({ err: error, buildId: build.id }, "failed to post failure status");
  });
}
