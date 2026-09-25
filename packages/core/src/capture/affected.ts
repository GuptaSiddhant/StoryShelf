import { selectAffectedStories } from "@storyshelf/affected";
import type { DatabaseAdapter } from "../db/database.ts";
import { BaselineModel, type BaselineTables } from "../models/baseline.ts";
import type { Baseline } from "../schema/baseline.ts";
import type { StoryEntry, Viewport } from "./adapter.ts";
import { resolveStoryViewports } from "./storybook.ts";

/** An inherit candidate paired with the baseline it reuses. */
export interface InheritedStory {
  story: StoryEntry;
  viewport: Viewport;
  baseline: Baseline;
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
  /** Affected import paths, or `null` to render everything. */
  affectedPaths: string[] | null;
}

/** Split one inherit candidate by per-viewport baseline availability. */
async function splitStory(
  baselines: BaselineModel,
  input: PartitionInput,
  story: StoryEntry,
): Promise<AffectedPartition> {
  const render: StoryEntry[] = [];
  const inherited: InheritedStory[] = [];
  const viewports = resolveStoryViewports(story, input.viewports);
  const settled = await Promise.all(
    viewports.map(async (viewport) => ({
      viewport,
      baseline: await baselines.resolve(
        input.projectId,
        story.id,
        viewport.name,
        input.branch,
        input.defaultBranch,
      ),
    })),
  );
  for (const { viewport, baseline } of settled) {
    if (baseline) {
      inherited.push({ story, viewport, baseline });
    } else if (!render.includes(story)) {
      render.push(story);
    }
  }
  return { render, inherited };
}

/** Merge per-story partitions into a single render/inherit split. */
function mergePartitions(partitions: AffectedPartition[]): AffectedPartition {
  const render: StoryEntry[] = [];
  const inherited: InheritedStory[] = [];
  for (const partition of partitions) {
    render.push(...partition.render);
    inherited.push(...partition.inherited);
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
  const partitions = await Promise.all(
    selected.inherit.map(async (story) => await splitStory(baselines, input, story)),
  );
  const merged = mergePartitions(partitions);
  return { render: [...selected.render, ...merged.render], inherited: merged.inherited };
}
