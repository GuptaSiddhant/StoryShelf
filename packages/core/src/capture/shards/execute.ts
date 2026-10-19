/** The render stage: one shard of a sharded capture, run by whichever worker picked up its job. */
import { CaptureShardModel } from "../../models/capture-shard.ts";
import { SnapshotModel } from "../../models/snapshot.ts";
import type { CaptureShard } from "../../schema/capture-shard.ts";
import { classifyFailures } from "../failure-sets.ts";
import { renderWork } from "../matrix.ts";
import type { CaptureJobOptions } from "../orchestrator.ts";
import { persistRendered } from "../pipeline.ts";
import { removeShardScratch } from "../scratch.ts";
import type { ShardPayload, ShardResult } from "../shard-plan.ts";
import { extractStorybookToScratch } from "../statics.ts";
import { loadTarget } from "../target.ts";
import { contextOf, matrixInputOf, type ShardTarget } from "./context.ts";
import { reduceBuild, type FinalSummary } from "./reduce.ts";

/** A shard job being run. */
export interface ShardRunInput {
  buildId: string;
  shard: string;
  reqId?: string | undefined;
  /**
   * Whether a failure now is the last word. A queue that redelivers failed jobs passes false until
   * its retries are used up, so a shard that will be retried does not end the build.
   */
  final?: boolean | undefined;
}

/** How a shard run ended. */
export type ShardOutcome =
  | { status: "skipped"; reason: string }
  | { status: "rendered"; finalized: false }
  | { status: "rendered"; finalized: true; summary: FinalSummary };

/**
 * Render and persist one shard, record its outcome, and, if it was the last one, finalize the build.
 *
 * Safe to run twice: a shard already done is skipped, and a rerun of an interrupted one starts from
 * a clean slate for its stories.
 */
export async function executeCaptureShard(
  input: ShardRunInput,
  options: CaptureJobOptions,
): Promise<ShardOutcome> {
  const picked = await pickShard(input, options);
  if ("status" in picked) {
    return picked;
  }
  await runShard(picked.target, picked.shard, input.final !== false);
  const summary = await reduceBuild(picked.target);
  return summary
    ? { status: "rendered", finalized: true, summary }
    : { status: "rendered", finalized: false };
}

/** Run the shard; a failure is recorded on its row (and, if final, reduces the build) then rethrown. */
async function runShard(target: ShardTarget, shard: CaptureShard, final: boolean): Promise<void> {
  const shards = new CaptureShardModel(target.options.db);
  await shards.markRunning(shard.id);
  try {
    await renderShard(target, shard);
  } catch (error) {
    await recordFailure(shards, shard, error, final);
    if (final) {
      await reduceBuild(target);
    }
    throw error;
  }
}

/** The shard to run and what to run it against, or why there is nothing to do. */
async function pickShard(
  input: ShardRunInput,
  options: CaptureJobOptions,
): Promise<
  { target: ShardTarget; shard: CaptureShard } | Extract<ShardOutcome, { status: "skipped" }>
> {
  const shard = await new CaptureShardModel(options.db).get(input.shard);
  if (shard?.kind !== "render" || shard.status === "done") {
    return {
      status: "skipped",
      reason: shard ? "shard already finished" : "shard no longer exists",
    };
  }
  const { build, project } = await loadTarget(options, input.buildId);
  if (build.status !== "capturing") {
    return { status: "skipped", reason: `build is ${build.status}` };
  }
  return { target: { options, build, project }, shard };
}

async function recordFailure(
  shards: CaptureShardModel,
  shard: CaptureShard,
  error: unknown,
  final: boolean,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await (final ? shards.fail(shard.id, message) : shards.retry(shard.id, message));
}

async function renderShard(target: ShardTarget, shard: CaptureShard): Promise<void> {
  const { options, build, project } = target;
  const payload = JSON.parse(shard.payload ?? "{}") as ShardPayload;
  const started = performance.now();
  const storybookDir = await extractStorybookToScratch(
    options.storage,
    options.scratchDir,
    project.id,
    build.id,
    shard.id,
  );
  try {
    const result = await renderAndPersist(target, payload, storybookDir);
    const durationMs = Math.round(performance.now() - started);
    await new CaptureShardModel(options.db).complete(
      shard.id,
      JSON.stringify({ ...result, durationMs } satisfies ShardResult),
    );
  } finally {
    await removeShardScratch(options.scratchDir, project.id, build.id, shard.id, options.logger);
  }
}

async function renderAndPersist(
  target: ShardTarget,
  payload: ShardPayload,
  storybookDir: string,
): Promise<Omit<ShardResult, "durationMs">> {
  const stories = payload.browsers.flatMap((engine) => engine.stories);
  const browsers = payload.browsers.map((engine) => engine.browser);
  const rendered = await renderWork(
    matrixInputOf(target, {
      stories,
      viewports: payload.viewports,
      browsers,
      storybookDir,
      affectedPaths: null,
    }),
    payload.browsers,
  );
  const failures = classifyFailures(stories, rendered.failures);
  const storyIds = new Set(stories.map((story) => story.id));
  await new SnapshotModel(target.options.db, target.options.tables).removeForStories(
    target.build.id,
    storyIds,
  );
  const persisted = await persistRendered(
    contextOf(target, {
      viewports: payload.viewports,
      browsers,
      captures: rendered.captures,
      freshBrowsers: new Set(payload.fresh),
    }),
    failures.blocking,
    failures.flaky,
    failures.a11y,
  );
  return {
    failedStoryIds: [...persisted.failed],
    flakyStoryIds: [...persisted.flaky],
    a11yStoryIds: [...persisted.a11y],
    captured: rendered.captures.length,
  };
}
