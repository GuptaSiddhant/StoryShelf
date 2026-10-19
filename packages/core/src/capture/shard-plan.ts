/** Splitting a build's render work into shards (ADR 0031 phase 5). Pure: no I/O, no clock. */
import type { BrowserName } from "../adapters/capture-runner.ts";
import type { StoryEntry, Viewport } from "./adapter.ts";

/** What one engine has to render this build (after affected-capture partitioning). */
export interface EngineWork {
  browser: BrowserName;
  stories: StoryEntry[];
}

/** One render shard: a slice of stories, with the engines each of them is rendered on. */
export interface ShardPayload {
  /** Engines of the slice, primary first; each lists only the stories it renders. */
  browsers: EngineWork[];
  /** Viewports the stories resolve against. */
  viewports: Viewport[];
  /** Engines with no baseline yet when the plan was made (fixed at plan time, not per shard). */
  fresh: string[];
}

/** Settings of the plan itself, kept on the plan row. */
export interface PlanPayload {
  browsers: string[];
  fresh: string[];
  /** Captures per shard the plan aimed for. */
  shardSize: number;
  /** Captures (story x viewport x engine) the plan covers. */
  total: number;
}

/** Outcome of one render shard, kept on its row. */
export interface ShardResult {
  failedStoryIds: string[];
  flakyStoryIds: string[];
  a11yStoryIds: string[];
  captured: number;
  durationMs: number;
}

/** Outcome of the plan stage: every story of the build, and stories whose inherited snapshot failed. */
export interface PlanResult {
  storyIds: string[];
  failedStoryIds: string[];
}

/**
 * Split the work into shards of about `size` captures, keeping a story's engines together so
 * a newly enabled engine can still bootstrap from its counterpart in the same shard.
 *
 * Returns `[]` when sharding is off or the build is too small to be worth it (up to twice the
 * shard size runs as one shard, exactly as before). Otherwise the slices are contiguous runs of
 * stories in their original order.
 *
 * @param work - Per-engine render lists, primary engine first.
 * @param capturesOf - Captures one story produces on one engine (its viewport count).
 * @param size - Target captures per shard; undefined or below 1 turns sharding off.
 */
export function planShards(
  work: readonly EngineWork[],
  capturesOf: (story: StoryEntry) => number,
  size: number | undefined,
): EngineWork[][] {
  if (!size || size < 1) {
    return [];
  }
  const costs = storyCosts(work, capturesOf);
  const total = [...costs.values()].reduce((sum, cost) => sum + cost, 0);
  if (total <= size * 2) {
    return [];
  }
  return sliceByCost([...costs.keys()], costs, size).map((ids) => restrictTo(work, new Set(ids)));
}

/** Total captures the work produces. */
export function totalCaptures(
  work: readonly EngineWork[],
  capturesOf: (story: StoryEntry) => number,
): number {
  return [...storyCosts(work, capturesOf).values()].reduce((sum, cost) => sum + cost, 0);
}

/** Captures per story id, summed over the engines that render it, in first-seen order. */
function storyCosts(
  work: readonly EngineWork[],
  capturesOf: (story: StoryEntry) => number,
): Map<string, number> {
  const costs = new Map<string, number>();
  for (const engine of work) {
    for (const story of engine.stories) {
      costs.set(story.id, (costs.get(story.id) ?? 0) + capturesOf(story));
    }
  }
  return costs;
}

/** Contiguous runs of ids whose cost stays within `size` (a single oversized story gets its own). */
function sliceByCost(ids: string[], costs: Map<string, number>, size: number): string[][] {
  const slices: { ids: string[]; used: number }[] = [];
  for (const id of ids) {
    const cost = costs.get(id) ?? 0;
    const last = slices.at(-1);
    if (last && last.used + cost <= size) {
      last.ids.push(id);
      last.used += cost;
    } else {
      slices.push({ ids: [id], used: cost });
    }
  }
  return slices.map((slice) => slice.ids);
}

/** The work restricted to some stories; engines left with nothing to render are dropped. */
function restrictTo(work: readonly EngineWork[], ids: ReadonlySet<string>): EngineWork[] {
  return work
    .map((engine) => ({
      browser: engine.browser,
      stories: engine.stories.filter((story) => ids.has(story.id)),
    }))
    .filter((engine) => engine.stories.length > 0);
}
