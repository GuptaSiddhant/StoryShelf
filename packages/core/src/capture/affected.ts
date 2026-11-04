import { selectAffectedStories } from "@storyshelf/affected";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { BaselineModel, type BaselineTables } from "../models/baseline.ts";
import { BuildModel } from "../models/build.ts";
import type { Baseline } from "../schema/baseline.ts";
import type { Build } from "../schema/build.ts";
import type { StoryEntry, Viewport } from "./adapter.ts";
import { resolveStoryViewports } from "./storybook.ts";

/**
 * Resolve the affected import paths for a build, or `null` for full capture (affected capture
 * disabled, or no computation was posted). The one rule for the whole and the sharded path alike.
 */
export function affectedPathsFor(
  build: Pick<Build, "affectedOnly" | "affectedImportPaths">,
): string[] | null {
  return build.affectedOnly ? BuildModel.affectedPaths(build) : null;
}

/** An inherit candidate paired with the baseline it reuses. */
export interface InheritedStory {
  story: StoryEntry;
  viewport: Viewport;
  baseline: Baseline;
  /** Engine whose baseline is reused (chromium when absent). */
  browser?: string;
}

/** Stories split into capture-now versus inherit-from-baseline sets. */
export interface AffectedPartition {
  render: StoryEntry[];
  inherited: InheritedStory[];
}

/** Inputs for partitioning a build's stories by affected status. */
export interface PartitionInput {
  db: DatabaseAdapter;
  tables: BaselineTables;
  projectId: string;
  branch: string;
  defaultBranch: string;
  stories: StoryEntry[];
  viewports: Viewport[];
  /** Engine to resolve baselines for (default chromium). */
  browser?: string;
  /** Affected import paths, or `null` to render everything. */
  affectedPaths: string[] | null;
  /** The commit the affected set was computed against (`builds.baseline_sha`), when known. */
  baselineSha?: string | null;
}

/** One viewport of an inherit candidate with the baseline it would reuse, if any. */
interface Candidate {
  story: StoryEntry;
  viewport: Viewport;
  baseline: Baseline | null;
}

/** Resolve the per-viewport baselines of one inherit candidate. */
async function candidatesOf(
  baselines: BaselineModel,
  input: PartitionInput,
  story: StoryEntry,
): Promise<Candidate[]> {
  const viewports = resolveStoryViewports(story, input.viewports);
  return await Promise.all(
    viewports.map(async (viewport) => ({
      story,
      viewport,
      baseline: await baselines.resolve(
        input.projectId,
        story.id,
        viewport.name,
        input.branch,
        input.defaultBranch,
        input.browser,
      ),
    })),
  );
}

/**
 * The baselines that were promoted after the comparison build: their source build is newer than
 * it, so the diff since the comparison commit says nothing about them (a per-snapshot approval on
 * a later build, then a revert). A baseline without a recorded source (legacy rows), or whose
 * source build is gone, is not listed and keeps being inherited, so an upgrade costs no full capture.
 */
async function promotedAfterComparison(
  input: PartitionInput,
  candidates: Candidate[],
): Promise<Set<string>> {
  const builds = new BuildModel(input.db);
  const comparison = input.baselineSha
    ? await builds.comparisonBuild(input.projectId, input.branch, input.baselineSha)
    : null;
  if (!comparison) {
    return new Set();
  }
  const sources = candidates.flatMap(({ baseline }) =>
    baseline?.sourceBuildId ? [baseline.sourceBuildId] : [],
  );
  const created = await builds.createdAtOf([...new Set(sources)]);
  return new Set(
    candidates.flatMap(({ baseline }) => {
      const at = baseline?.sourceBuildId ? created.get(baseline.sourceBuildId) : undefined;
      return baseline && at !== undefined && at > comparison.createdAt ? [baseline.id] : [];
    }),
  );
}

/** Split the candidates into stories to render and baselines to inherit. */
function splitCandidates(
  candidates: Candidate[],
  promoted: ReadonlySet<string>,
  browser: string | undefined,
): AffectedPartition {
  const render: StoryEntry[] = [];
  const inherited: InheritedStory[] = [];
  for (const { story, viewport, baseline } of candidates) {
    if (baseline && !promoted.has(baseline.id)) {
      inherited.push({ story, viewport, baseline, ...(browser ? { browser } : {}) });
    } else if (!render.includes(story)) {
      render.push(story);
    }
  }
  return { render, inherited };
}

/**
 * Partition discovered stories into render versus inherit sets.
 *
 * Stories outside the affected set inherit their baseline without rendering,
 * except when no baseline exists (new stories always render). A `null`
 * affected set renders everything.
 */
export async function partitionAffectedStories(input: PartitionInput): Promise<AffectedPartition> {
  const selected = selectAffectedStories(input.stories, input.affectedPaths);
  if (selected.inherit.length === 0) {
    return { render: selected.render, inherited: [] };
  }
  const baselines = new BaselineModel(input.db, input.tables);
  const candidates = (
    await Promise.all(
      selected.inherit.map(async (story) => await candidatesOf(baselines, input, story)),
    )
  ).flat();
  const promoted = await promotedAfterComparison(input, candidates);
  const split = splitCandidates(candidates, promoted, input.browser);
  return { render: [...selected.render, ...split.render], inherited: split.inherited };
}
