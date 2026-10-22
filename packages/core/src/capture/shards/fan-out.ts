/** The plan stage: decide what to render, record it as shards, and hand the shards to the queue. */
import type { Logger } from "pino";
import type { CaptureTarget } from "../../adapters/capture-runner.ts";
import { CaptureAttemptModel, emitAttemptLog } from "../../models/capture-attempt.ts";
import { CaptureShardModel } from "../../models/capture-shard.ts";
import { SnapshotModel } from "../../models/snapshot.ts";
import type { CaptureShard } from "../../schema/capture-shard.ts";
import type { Viewport } from "../adapter.ts";
import { affectedPathsFor, type InheritedStory } from "../affected.ts";
import { partitionBrowsers, type MatrixInput } from "../matrix.ts";
import type { CaptureJobInput, CaptureSummary } from "../orchestrator.ts";
import { freshBrowsersOf, persistInherited } from "../pipeline.ts";
import {
  planShards,
  worthSharding,
  type EngineWork,
  type PlanPayload,
  type PlanResult,
  type ShardPayload,
} from "../shard-plan.ts";
import { resolveStoryViewports } from "../storybook.ts";
import { contextOf, matrixInputOf, type ShardTarget } from "./context.ts";
import { storyDurations } from "./history.ts";

/** Inputs for {@link fanOutCapture}: the plan stage's view of the build. */
export interface FanOutInput extends ShardTarget {
  input: CaptureJobInput;
  stories: MatrixInput["stories"];
  viewports: Viewport[];
  browsers: CaptureTarget[];
  logger: Logger | undefined;
  /** Set by the plan stage: whether past timings were available to order the shards by. */
  timed?: boolean;
}

/**
 * The plan stage. When sharding is on and the build is big enough, decide what to render, record
 * the plan and its shards, and hand the shards to the queue; otherwise return null and the caller
 * renders the build in one piece as it always has.
 *
 * Inherited snapshots (affected capture) are written here, since nothing renders for them.
 */
export async function fanOutCapture(args: FanOutInput): Promise<CaptureSummary | null> {
  const { options } = args;
  if (!options.shardSize || !options.enqueue) {
    return null;
  }
  const matrix = matrixInputOf(args, {
    stories: args.stories,
    viewports: args.viewports,
    browsers: args.browsers,
    storybookDir: "",
    affectedPaths: affectedPathsFor(args.build),
    logger: args.logger,
    recordLog: args.input.recordLog,
    progress: args.input.progress,
  });
  const partition = await partitionBrowsers(matrix);
  const capturesOf = (story: MatrixInput["stories"][number]): number =>
    resolveStoryViewports(story, args.viewports).length;
  // Past timings only order the shards: not worth a lookup for a build that runs in one piece.
  return worthSharding(partition.work, capturesOf, options.shardSize)
    ? await planAndCommit(args, partition, capturesOf)
    : null;
}

async function planAndCommit(
  args: FanOutInput,
  partition: { work: EngineWork[]; inherited: InheritedStory[] },
  capturesOf: (story: MatrixInput["stories"][number]) => number,
): Promise<CaptureSummary | null> {
  const durations = await storyDurations(args);
  const slices = planShards(partition.work, capturesOf, args.options.shardSize, (storyId) =>
    durations.get(storyId),
  );
  return slices.length === 0
    ? null
    : await commitPlan({ ...args, timed: durations.size > 0 }, slices, partition);
}

async function commitPlan(
  args: FanOutInput,
  slices: EngineWork[][],
  partition: { work: EngineWork[]; inherited: InheritedStory[] },
): Promise<CaptureSummary> {
  await supersedeEarlierRuns(args);
  const ctx = contextOf(args, {
    viewports: args.viewports,
    browsers: args.browsers,
    inherited: partition.inherited,
    progress: args.input.progress,
  });
  const failedInherits = await persistInherited(ctx);
  const storyIds = new Set([
    ...partition.work.flatMap((engine) => engine.stories.map((story) => story.id)),
    ...partition.inherited.map((inherited) => inherited.story.id),
  ]);
  const fresh = [...(await freshBrowsersOf(ctx))];
  const rows = await recordPlan(args, slices, { fresh, storyIds, failed: failedInherits });
  await handOut(args, rows);
  await emitAttemptLog(args.input.recordLog, args.logger, "info", "capture planned", {
    shards: rows.length,
    stories: storyIds.size,
    ordering: args.timed ? "longest-first" : "by-capture-count",
  });
  return { storyCount: storyIds.size, failedCount: failedInherits.size, shards: rows.length };
}

/**
 * A new plan of a build (recovery requeue, retry, a redelivered plan job) starts clean: the
 * snapshots an earlier plan or its shards wrote are dropped, so inherited rows are not doubled,
 * and the attempts it left open are closed, since only the newest plan's attempt is ever closed.
 */
async function supersedeEarlierRuns(args: FanOutInput): Promise<void> {
  const { db, tables } = args.options;
  await new SnapshotModel(db, tables).removeForBuild(args.build.id);
  await new CaptureAttemptModel(db, tables).closeOthers(
    args.build.id,
    args.input.attempt?.id ?? null,
    "superseded by a new capture plan",
  );
}

async function recordPlan(
  args: FanOutInput,
  slices: EngineWork[][],
  plan: { fresh: string[]; storyIds: Set<string>; failed: ReadonlySet<string> },
): Promise<CaptureShard[]> {
  const shards = new CaptureShardModel(args.options.db);
  await shards.clearBuild(args.build.id);
  const settings: PlanPayload = {
    browsers: args.browsers,
    fresh: plan.fresh,
    shardSize: args.options.shardSize ?? 0,
    total: slices.length,
  };
  const result: PlanResult = { storyIds: [...plan.storyIds], failedStoryIds: [...plan.failed] };
  return await shards.createPlan(
    args.project.id,
    args.build.id,
    {
      attemptId: args.input.attempt?.id ?? null,
      payload: JSON.stringify(settings),
      result: JSON.stringify(result),
    },
    slices.map((browsers) => ({ payload: shardPayload(args, browsers, plan.fresh) })),
  );
}

function shardPayload(args: FanOutInput, browsers: EngineWork[], fresh: string[]): string {
  const payload: ShardPayload = { browsers, viewports: args.viewports, fresh };
  return JSON.stringify(payload);
}

/** Enqueue every shard in order; the caller marks the build failed if the queue refuses one. */
async function handOut(args: FanOutInput, rows: CaptureShard[]): Promise<void> {
  const { enqueue } = args.options;
  for (const row of rows) {
    // oxlint-disable-next-line no-await-in-loop -- shards are queued in plan order
    await enqueue?.({
      buildId: args.build.id,
      shard: row.id,
      reqId: args.input.reqId,
      traceparent: args.input.traceparent,
    });
  }
}
