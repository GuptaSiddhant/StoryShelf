/** The render stage: one shard of a sharded capture, run by whichever worker picked up its job. */
import { CaptureShardModel } from "../../models/capture-shard.ts";
import { SnapshotModel } from "../../models/snapshot.ts";
import type { CaptureShard } from "../../schema/capture-shard.ts";
import { classifyFailures } from "../failure-sets.ts";
import { renderWork } from "../matrix.ts";
import type { CaptureJobOptions } from "../orchestrator.ts";
import { persistRendered } from "../pipeline.ts";
import type { CaptureProgress } from "../progress.ts";
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
  /** Reports render and persist progress to the job's lease (see `leaseProgress`). */
  progress?: CaptureProgress | undefined;
  /**
   * Called once by the run that finalized the build, and by no other, with the summary and, when
   * the shard that ended the build failed, its error. The caller closes the plan's attempt here.
   */
  onFinalized?: ((summary: FinalSummary, error?: unknown) => Promise<void>) | undefined;
}

/** How a shard run ended. */
export type ShardOutcome =
  | { status: "skipped"; reason: string }
  | { status: "rendered"; finalized: false }
  | { status: "rendered"; finalized: true; summary: FinalSummary }
  /** The shard was already done, but the build was not: this run finalized it. */
  | { status: "reduced"; summary: FinalSummary };

/**
 * Render and persist one shard, record its outcome, and, if it was the last one, finalize the build.
 *
 * Safe to run twice: a shard already done is not rendered again, and a rerun of an interrupted one
 * starts from a clean slate for its stories. A redelivered shard that is already done still tries
 * to finalize the build, in case the run that finished it died or failed before it could.
 */
export async function executeCaptureShard(
  input: ShardRunInput,
  options: CaptureJobOptions,
): Promise<ShardOutcome> {
  const picked = await pickShard(input, options);
  if ("status" in picked) {
    return picked;
  }
  const final = input.final !== false;
  if (picked.shard.status === "done") {
    return await reduceFinished(picked.target, input, final);
  }
  await runShard(picked.target, picked.shard, input, final);
  return await reduceRendered(picked.target, input, final);
}

/** The shard is done: if it was the last one, this run finalizes the build. */
async function reduceRendered(
  target: ShardTarget,
  input: ShardRunInput,
  final: boolean,
): Promise<ShardOutcome> {
  const summary = await reduceBuild(target, final);
  if (!summary) {
    return { status: "rendered", finalized: false };
  }
  await input.onFinalized?.(summary);
  return { status: "rendered", finalized: true, summary };
}

/** A redelivered shard that an earlier run finished: finalize the build if nobody has. */
async function reduceFinished(
  target: ShardTarget,
  input: ShardRunInput,
  final: boolean,
): Promise<ShardOutcome> {
  const summary = await reduceBuild(target, final);
  if (!summary) {
    return { status: "skipped", reason: "shard already finished" };
  }
  await input.onFinalized?.(summary);
  return { status: "reduced", summary };
}

/** Run the shard; a failure is recorded on its row (and, if final, reduces the build) then rethrown. */
async function runShard(
  target: ShardTarget,
  shard: CaptureShard,
  input: ShardRunInput,
  final: boolean,
): Promise<void> {
  const shards = new CaptureShardModel(target.options.db);
  await shards.markRunning(shard.id);
  input.progress?.();
  try {
    await renderShard(target, shard, input.progress);
  } catch (error) {
    await recordFailure(shards, shard, error, final);
    if (final) {
      await finalizeAfterFailure(target, input, error);
    }
    throw error;
  }
}

/**
 * The shard failed for good: if it was the last one open, it ends the build, and only then does
 * this run report it. A failure here is logged, not thrown: the shard's own error is the news.
 */
async function finalizeAfterFailure(
  target: ShardTarget,
  input: ShardRunInput,
  error: unknown,
): Promise<void> {
  try {
    const summary = await reduceBuild(target, true);
    if (summary) {
      await input.onFinalized?.(summary, error);
    }
  } catch (reduceError) {
    target.options.logger?.error(
      { err: reduceError, buildId: target.build.id },
      "finalizing after a failed shard failed",
    );
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
  if (shard?.kind !== "render") {
    return { status: "skipped", reason: "shard no longer exists" };
  }
  const { build, project } = await loadTarget(options, input.buildId);
  if (build.status !== "capturing") {
    const reason = shard.status === "done" ? "shard already finished" : `build is ${build.status}`;
    return { status: "skipped", reason };
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

async function renderShard(
  target: ShardTarget,
  shard: CaptureShard,
  progress: CaptureProgress | undefined,
): Promise<void> {
  const { options, build, project } = target;
  const payload = JSON.parse(shard.payload ?? "{}") as ShardPayload;
  const started = performance.now();
  const storybookDir = await extractStorybookToScratch(
    options.storage,
    options.scratchDir,
    project.id,
    build.id,
    shard.id,
    options.limits,
  );
  progress?.();
  try {
    const result = await renderAndPersist(target, payload, {
      storybookDir,
      runId: shard.id,
      shardIndex: shard.ordinal,
      progress,
    });
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
  run: {
    storybookDir: string;
    runId: string;
    shardIndex: number;
    progress: CaptureProgress | undefined;
  },
): Promise<Omit<ShardResult, "durationMs">> {
  const stories = payload.browsers.flatMap((engine) => engine.stories);
  const browsers = payload.browsers.map((engine) => engine.browser);
  const rendered = await renderWork(
    matrixInputOf(target, {
      stories,
      viewports: payload.viewports,
      browsers,
      storybookDir: run.storybookDir,
      affectedPaths: null,
      progress: run.progress,
      runId: run.runId,
      shardIndex: run.shardIndex,
    }),
    payload.browsers,
  );
  const failures = classifyFailures(stories, rendered.failures);
  await clearEarlierRun(target, payload);
  const persisted = await persistRendered(
    contextOf(target, {
      viewports: payload.viewports,
      browsers,
      captures: rendered.captures,
      freshBrowsers: new Set(payload.fresh),
      progress: run.progress,
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

/**
 * Drop what an interrupted earlier run of this shard persisted: the rendered rows of the
 * (story, engine) pairs it is about to write. The plan's inherited rows stay, including those of
 * these stories on engines or viewports this shard does not render.
 */
async function clearEarlierRun(target: ShardTarget, payload: ShardPayload): Promise<void> {
  await new SnapshotModel(target.options.db, target.options.tables).removeRendered(
    target.build.id,
    payload.browsers.map((engine) => ({
      browser: engine.browser,
      storyIds: new Set(engine.stories.map((story) => story.id)),
    })),
  );
}
