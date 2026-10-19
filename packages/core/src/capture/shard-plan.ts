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
 * shard size runs as one shard, exactly as before).
 *
 * Without timings the slices are contiguous runs of stories in their original order. Given
 * `weightOf`, the stories are packed longest-first into shards of equal capture capacity and the
 * shards come back heaviest first, so the slow work starts early and no shard straggles.
 *
 * @param work - Per-engine render lists, primary engine first.
 * @param capturesOf - Captures one story produces on one engine (its viewport count).
 * @param size - Target captures per shard; undefined or below 1 turns sharding off.
 * @param weightOf - What a story cost last time, in milliseconds; unknown for a story returns undefined.
 */
export function planShards(
  work: readonly EngineWork[],
  capturesOf: (story: StoryEntry) => number,
  size: number | undefined,
  weightOf?: (storyId: string) => number | undefined,
): EngineWork[][] {
  if (!size || size < 1) {
    return [];
  }
  const costs = storyCosts(work, capturesOf);
  const total = [...costs.values()].reduce((sum, cost) => sum + cost, 0);
  if (total <= size * 2) {
    return [];
  }
  const weights = weightOf ? weighted(costs, weightOf) : undefined;
  const slices = weights ? packLongestFirst(costs, weights, size) : sliceByCost(costs, size);
  return slices.map((ids) => restrictTo(work, new Set(ids)));
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

/**
 * What each story is expected to cost in milliseconds. A story nothing is known about is priced at
 * the average cost of one capture, so a new story is treated as ordinary rather than free.
 */
function weighted(
  costs: Map<string, number>,
  weightOf: (storyId: string) => number | undefined,
): Map<string, number> | undefined {
  const known = [...costs.keys()].flatMap((id) => {
    const weight = weightOf(id);
    return typeof weight === "number" && weight > 0 ? [[id, weight] as const] : [];
  });
  if (known.length === 0) {
    return undefined;
  }
  const knownCaptures = known.reduce((sum, [id]) => sum + (costs.get(id) ?? 0), 0);
  const perCapture =
    known.reduce((sum, [, weight]) => sum + weight, 0) / Math.max(knownCaptures, 1);
  const weights = new Map(known);
  for (const [id, captures] of costs) {
    if (!weights.has(id)) {
      weights.set(id, perCapture * captures);
    }
  }
  return weights;
}

/**
 * Longest-processing-time packing: the dearest stories are placed first, each into the shard that
 * has the least work so far and still has room for its captures. Shards come back heaviest first.
 */
function packLongestFirst(
  costs: Map<string, number>,
  weights: Map<string, number>,
  size: number,
): string[][] {
  const count = Math.max(1, Math.ceil(sumOf(costs) / size));
  const bins: Bin[] = Array.from({ length: count }, newBin);
  for (const id of byWeightDescending(costs, weights)) {
    const captures = costs.get(id) ?? 0;
    const bin = binFor(bins, captures, size);
    bin.ids.push(id);
    bin.captures += captures;
    bin.weight += weights.get(id) ?? 0;
  }
  return bins
    .filter((bin) => bin.ids.length > 0)
    .toSorted((left, right) => right.weight - left.weight)
    .map((bin) => bin.ids);
}

/** Story ids dearest first; equal cost keeps the order they were planned in. */
function byWeightDescending(costs: Map<string, number>, weights: Map<string, number>): string[] {
  return [...costs.keys()].toSorted(
    (left, right) => (weights.get(right) ?? 0) - (weights.get(left) ?? 0),
  );
}

/** One shard being filled: the stories in it, their captures and what they are expected to cost. */
interface Bin {
  ids: string[];
  captures: number;
  weight: number;
}

function newBin(): Bin {
  return { ids: [], captures: 0, weight: 0 };
}

/**
 * The shard with the least work that still has room for `captures`. When none has room the last
 * stories did not fit anywhere, so a shard is added: one more beats overfilling one, just as an
 * oversized story gets a shard of its own when there are no timings.
 */
function binFor(bins: Bin[], captures: number, size: number): Bin {
  const withRoom = bins.filter((bin) => bin.captures + captures <= size);
  const [lightest] = withRoom.toSorted((left, right) => left.weight - right.weight);
  if (lightest) {
    return lightest;
  }
  const fresh = newBin();
  bins.push(fresh);
  return fresh;
}

function sumOf(costs: Map<string, number>): number {
  return [...costs.values()].reduce((sum, cost) => sum + cost, 0);
}

/** Contiguous runs of ids whose cost stays within `size` (a single oversized story gets its own). */
function sliceByCost(costs: Map<string, number>, size: number): string[][] {
  const slices: { ids: string[]; used: number }[] = [];
  for (const id of costs.keys()) {
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
