/** The reduce stage: when the last render shard ends, exactly one worker finishes the build. */
import { BuildModel } from "../../models/build.ts";
import { CaptureShardModel } from "../../models/capture-shard.ts";
import type { CaptureShard } from "../../schema/capture-shard.ts";
import type { BuildStatus } from "../../types.ts";
import { JobAbortedError } from "../../utils/job-aborted.ts";
import { finalizeBuild } from "../pipeline.ts";
import type { CaptureProgress } from "../progress.ts";
import type { PlanResult, ShardPayload, ShardResult } from "../shard-plan.ts";
import { contextOf, type ShardTarget } from "./context.ts";

/** The finished build, reported by whichever worker finalized it. */
export interface FinalSummary {
  storyCount: number;
  failedCount: number;
  buildStatus: BuildStatus;
  /** The attempt row the plan was made under, to be closed by the caller. */
  attemptId: string | null;
  /** Set when the finalize itself failed on a last try, and the build was failed for it. */
  error?: string;
}

/**
 * When every render shard has ended, claim the finalize (exactly one worker can) and finish the
 * build from the plan and the shards' outcomes. Returns the summary for the winner, else null.
 *
 * A finalize that throws gives its claim back, so the next run to reduce the build (a redelivery
 * of the same shard) finalizes it instead of finding the claim taken. On a last try (`final`)
 * nothing will come back for it, so the build is failed and the failure reported as the summary.
 * `progress` is the run's checkpoint: called once the claim is held and before the build's terminal
 * writes, so an abandoned run gives the claim back and rethrows, failing nothing (a redelivery
 * finalizes). The finalize itself, once started, is not interrupted.
 */
export async function reduceBuild(
  target: ShardTarget,
  final = true,
  progress?: CaptureProgress,
): Promise<FinalSummary | null> {
  const shards = new CaptureShardModel(target.options.db);
  const rows = await closedShards(shards, target.build.id);
  if (!rows || !(await shards.claimFinalize(target.project.id, target.build.id))) {
    return null;
  }
  return await finalizeClaimed(target, shards, rows, { final, progress });
}

/** Finalize under the claim this run holds; on failure, give the claim back. */
async function finalizeClaimed(
  target: ShardTarget,
  shards: CaptureShardModel,
  rows: CaptureShard[],
  run: { final: boolean; progress: CaptureProgress | undefined },
): Promise<FinalSummary> {
  const plan = await shards.plan(target.build.id);
  try {
    run.progress?.();
    const summary = await finalizeSharded(target, rows, plan);
    await shards.finishFinalize(target.build.id);
    return summary;
  } catch (error) {
    await shards.releaseFinalize(target.build.id);
    if (!run.final || error instanceof JobAbortedError) {
      throw error;
    }
    return await failFinalize(target, plan, error);
  }
}

/** The build's render shards once every one has ended, else null (none, or some still open). */
async function closedShards(
  shards: CaptureShardModel,
  buildId: string,
): Promise<CaptureShard[] | null> {
  const rows = await shards.renderShards(buildId);
  const open = rows.some((row) => row.status === "pending" || row.status === "running");
  return rows.length === 0 || open ? null : rows;
}

async function finalizeSharded(
  target: ShardTarget,
  rows: CaptureShard[],
  plan: CaptureShard | null,
): Promise<FinalSummary> {
  const planResult = planResultOf(plan);
  const sets = collectSets(rows, planResult);
  await finalizeBuild(
    contextOf(target, { viewports: [], browsers: [] }),
    new Set(planResult.storyIds ?? []),
    sets.failed,
    sets.flaky,
    sets.a11y,
  );
  const finished = await new BuildModel(target.options.db, target.options.tables).get(
    target.build.id,
  );
  return {
    storyCount: planResult.storyIds?.length ?? 0,
    failedCount: sets.failed.size,
    buildStatus: finished?.status ?? "failed",
    attemptId: plan?.attemptId ?? null,
  };
}

/** The last try at finalizing failed: fail the build, so it does not sit in `capturing`. */
async function failFinalize(
  target: ShardTarget,
  plan: CaptureShard | null,
  error: unknown,
): Promise<FinalSummary> {
  await new BuildModel(target.options.db, target.options.tables).setStatus(
    target.build.id,
    "failed",
  );
  return {
    storyCount: planResultOf(plan).storyIds?.length ?? 0,
    failedCount: 0,
    buildStatus: "failed",
    attemptId: plan?.attemptId ?? null,
    error: error instanceof Error ? error.message : String(error),
  };
}

/**
 * The counts a finalized build reported (what {@link reduceBuild} put in its summary), rebuilt from
 * the plan and the shards' outcomes, for a retry that must close the attempt without finalizing the
 * build again.
 */
export async function finalizedCounts(
  shards: CaptureShardModel,
  buildId: string,
): Promise<{ storyCount: number; failedCount: number }> {
  const planResult = planResultOf(await shards.plan(buildId));
  const rows = await shards.renderShards(buildId);
  return {
    storyCount: planResult.storyIds?.length ?? 0,
    failedCount: collectSets(rows, planResult).failed.size,
  };
}

function planResultOf(plan: CaptureShard | null): Partial<PlanResult> {
  return JSON.parse(plan?.result ?? "{}") as Partial<PlanResult>;
}

interface FailureUnion {
  failed: Set<string>;
  flaky: Set<string>;
  a11y: Set<string>;
}

/** Union the plan's and every shard's failures; a shard that ended `failed` fails all its stories. */
function collectSets(rows: CaptureShard[], plan: Partial<PlanResult>): FailureUnion {
  const union: FailureUnion = {
    failed: new Set(plan.failedStoryIds ?? []),
    flaky: new Set(),
    a11y: new Set(),
  };
  for (const row of rows) {
    if (row.status === "failed") {
      addAll(union.failed, storyIdsOf(row));
    } else {
      addShardResult(union, JSON.parse(row.result ?? "{}") as Partial<ShardResult>);
    }
  }
  return union;
}

function addShardResult(union: FailureUnion, result: Partial<ShardResult>): void {
  addAll(union.failed, result.failedStoryIds ?? []);
  addAll(union.flaky, result.flakyStoryIds ?? []);
  addAll(union.a11y, result.a11yStoryIds ?? []);
}

function addAll(into: Set<string>, ids: readonly string[]): void {
  for (const id of ids) {
    into.add(id);
  }
}

function storyIdsOf(row: CaptureShard): string[] {
  const payload = JSON.parse(row.payload ?? "{}") as Partial<ShardPayload>;
  return (payload.browsers ?? []).flatMap((engine) => engine.stories.map((story) => story.id));
}
