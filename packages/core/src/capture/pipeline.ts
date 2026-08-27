import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import { diffImages } from "../diff/engine.ts";
import { DEFAULT_DIFF_OPTIONS } from "../diff/options.ts";
import { BaselineModel } from "../models/baseline.ts";
import { BuildModel } from "../models/build.ts";
import { SnapshotModel } from "../models/snapshot.ts";
import type { Baseline, Build, Project } from "../schema.ts";
import { diffPath, screenshotPath } from "../utils/paths.ts";
import type { StoryEntry, StorySourceAdapter, Viewport } from "./adapter.ts";

/** Renders a single story at a viewport and returns the screenshot bytes. */
export interface RenderStory {
  (story: StoryEntry, viewport: Viewport): Promise<Buffer>;
}

/** Everything the capture pipeline needs to run against a build. */
export interface CaptureContext {
  /** Database adapter. */
  db: DatabaseAdapter;
  /** Storage adapter. */
  storage: StorageAdapter;
  /** The project being captured. */
  project: Project;
  /** The build being captured. */
  build: Build;
  /** Directory containing the built Storybook. */
  storybookDir: string;
  /** Viewports at which stories are captured. */
  viewports: Viewport[];
  /** Adapter used to discover and render stories. */
  adapter: StorySourceAdapter;
  /** Function that renders a story into a screenshot buffer. */
  renderStory: RenderStory;
}

/**
 * Run the capture pipeline for a build: discover stories, capture and diff
 * snapshots across viewports, then finalize the build.
 *
 * @param ctx - Capture context.
 */
export async function runCapture(ctx: CaptureContext): Promise<void> {
  const stories = await ctx.adapter.discover(ctx.storybookDir);
  await Promise.all(
    ctx.viewports.flatMap((viewport) =>
      stories.map(async (story) => {
        await captureStory(ctx, story, viewport);
      }),
    ),
  );
  await finalize(ctx, stories.map((s) => s.id));
}

async function captureStory(ctx: CaptureContext, story: StoryEntry, viewport: Viewport): Promise<void> {
  const buffer = await ctx.renderStory(story, viewport);
  const screenshot = screenshotPath(ctx.project.id, ctx.build.id, story.id, viewport.name);
  await ctx.storage.write(screenshot, buffer);

  const baseline = await resolveBaseline(ctx, story.id, viewport.name);
  if (!baseline) {
    await createWithoutBaseline(ctx, story, viewport, screenshot);
    return;
  }
  await createWithBaseline(ctx, story, viewport, screenshot, baseline.screenshotPath);
}

async function resolveBaseline(ctx: CaptureContext, storyId: string, viewport: string): Promise<Baseline | null> {
  const baselines = new BaselineModel(ctx.db, ctx.storage);
  return await baselines.resolve(ctx.project.id, storyId, viewport, ctx.build.gitBranch, ctx.project.gitDefaultBranch);
}

async function createWithoutBaseline(ctx: CaptureContext, story: StoryEntry, viewport: Viewport, screenshot: string): Promise<void> {
  const snapshots = new SnapshotModel(ctx.db);
  const status = ctx.build.isDefault ? "approved" : "new";
  const snapshot = await snapshots.create(ctx.project.id, ctx.build.id, {
    storyId: story.id,
    storyName: story.name,
    storyTitle: story.title,
    storyImportPath: story.importPath,
    viewportName: viewport.name,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    screenshotPath: screenshot,
  });
  await snapshots.setStatus(snapshot.id, status);

  if (ctx.build.isDefault) {
    const baselines = new BaselineModel(ctx.db, ctx.storage);
    await baselines.upsert(ctx.project.id, story.id, viewport.name, ctx.build.gitBranch, snapshot.id, screenshot);
  }
}

async function createWithBaseline(ctx: CaptureContext, story: StoryEntry, viewport: Viewport, screenshot: string, baselinePath: string): Promise<void> {
  const current = await ctx.storage.read(screenshot);
  const previous = await ctx.storage.read(baselinePath);
  const options = { ...DEFAULT_DIFF_OPTIONS, pixelThreshold: ctx.project.pixelThreshold, maxDiffRatio: ctx.project.maxDiffRatio };
  const result = diffImages(previous, current, options);

  const snapshots = new SnapshotModel(ctx.db);
  const snapshot = await snapshots.create(ctx.project.id, ctx.build.id, {
    storyId: story.id,
    storyName: story.name,
    storyTitle: story.title,
    storyImportPath: story.importPath,
    viewportName: viewport.name,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    screenshotPath: screenshot,
  });

  const status = result.passed ? "unchanged" : "changed";
  const diff = diffPath(ctx.project.id, ctx.build.id, story.id, viewport.name);
  if (!result.passed && result.diffImage) {
    await ctx.storage.write(diff, result.diffImage);
  }
  await snapshots.update(snapshot.id, {
    status,
    diffPath: result.passed ? null : diff,
    diffPixels: result.diffPixels,
    diffRatio: result.diffRatio,
    diffPassed: result.passed,
  });
}

async function finalize(ctx: CaptureContext, storyIds: string[]): Promise<void> {
  const builds = new BuildModel(ctx.db);
  const build = await builds.updateCounts(ctx.build.id);
  const status = build.changedCount === 0 ? "approved" : "reviewing";
  await builds.setStatus(ctx.build.id, status);

  if (ctx.build.isDefault) {
    const baselines = new BaselineModel(ctx.db, ctx.storage);
    await baselines.removeOrphans(ctx.project.id, new Set(storyIds));
  }
}
