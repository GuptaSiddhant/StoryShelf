/** The reduce stage: when the last render shard ends, exactly one worker finishes the build. */
import { BuildModel } from "../../models/build.ts";
import { CaptureShardModel } from "../../models/capture-shard.ts";
import type { CaptureShard } from "../../schema/capture-shard.ts";
import type { BuildStatus } from "../../types.ts";
import { finalizeBuild } from "../pipeline.ts";
import { removeBuildScratch } from "../scratch.ts";
import type { PlanResult, ShardPayload, ShardResult } from "../shard-plan.ts";
import { contextOf, type ShardTarget } from "./context.ts";

/** The finished build, reported by whichever worker finalized it. */
export interface FinalSummary {
  storyCount: number;
  failedCount: number;
  buildStatus: BuildStatus;
  /** The attempt row the plan was made under, to be closed by the caller. */
  attemptId: string | null;
}

/**
 * When every render shard has ended, claim the finalize (exactly one worker can) and finish the
 * build from the plan and the shards' outcomes. Returns the summary for the winner, else null.
 */
export async function reduceBuild(target: ShardTarget): Promise<FinalSummary | null> {
  const shards = new CaptureShardModel(target.options.db);
  const rows = await shards.renderShards(target.build.id);
  const open = rows.some((row) => row.status === "pending" || row.status === "running");
  if (rows.length === 0 || open) {
    return null;
  }
  if (!(await shards.claimFinalize(target.project.id, target.build.id))) {
    return null;
  }
  return await finalizeSharded(target, rows, await shards.plan(target.build.id));
}

async function finalizeSharded(
  target: ShardTarget,
  rows: CaptureShard[],
  plan: CaptureShard | null,
): Promise<FinalSummary> {
  const planResult = JSON.parse(plan?.result ?? "{}") as Partial<PlanResult>;
  const sets = collectSets(rows, planResult);
  await finalizeBuild(
    contextOf(target, { viewports: [], browsers: [] }),
    new Set(planResult.storyIds ?? []),
    sets.failed,
    sets.flaky,
    sets.a11y,
  );
  // Every shard has ended, so nothing is left to extract here; sweep the empty build directory.
  await removeBuildScratch(
    target.options.scratchDir,
    target.project.id,
    target.build.id,
    target.options.logger,
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
