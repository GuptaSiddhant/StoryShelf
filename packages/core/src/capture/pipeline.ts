import type { Logger } from "pino";
import type { RenderedSnapshot } from "../adapters/capture-runner.ts";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import { diffImages } from "../diff/engine.ts";
import { DEFAULT_DIFF_OPTIONS } from "../diff/options.ts";
import { BaselineModel } from "../models/baseline.ts";
import { BuildModel } from "../models/build.ts";
import { SnapshotModel } from "../models/snapshot.ts";
import type { Baseline } from "../schema/baseline.ts";
import type { Build } from "../schema/build.ts";
import type { Project } from "../schema/project.ts";
import type { BuildStatus } from "../types.ts";
import { diffPath, screenshotPath } from "../utils/paths.ts";
import type { Viewport } from "./adapter.ts";

/** Persistence inputs for a completed capture run. */
export interface CaptureContext {
  /** Database adapter. */
  db: DatabaseAdapter;
  /** Storage adapter. */
  storage: StorageAdapter;
  /** The project being captured. */
  project: Project;
  /** The build being captured. */
  build: Build;
  /** Viewports at which stories were captured. */
  viewports: Viewport[];
  /** Screenshot buffers produced by the capture renderer. */
  captures: RenderedSnapshot[];
  /** Optional logger for capture diagnostics. */
  logger?: Logger;
}

/**
 * Persist a completed capture run: write screenshots, diff against the branch
 * baseline, create snapshots, and finalize the build.
 *
 * Rendering is performed by a pure `CaptureRunner`; this function owns only
 * storage writes and record keeping, so it can run against any renderer.
 *
 * @param ctx - Capture context.
 * @param renderFailedStoryIds - Story ids that the renderer could not capture
 * (blocking failures). They force the build to `failed`.
 * @param flakyFailedStoryIds - Story ids that failed but are marked flaky
 * (non-blocking). They are logged as warnings and do not block the build.
 */
export async function persistCapture(
  ctx: CaptureContext,
  renderFailedStoryIds: ReadonlySet<string> = new Set(),
  flakyFailedStoryIds: ReadonlySet<string> = new Set(),
): Promise<void> {
  const failedStoryIds = new Set(renderFailedStoryIds);
  const flakyIds = new Set(flakyFailedStoryIds);
  await Promise.all(
    ctx.captures.map(async (capture) => {
      try {
        await persistSnapshot(ctx, capture);
      } catch (error) {
        // A failure in one story/viewport must not abort the other persists.
        // Flaky stories remain non-blocking even on persist failure.
        if (flakyIds.has(capture.story.id)) {
          flakyIds.add(capture.story.id);
          ctx.logger?.warn(
            { storyId: capture.story.id, viewport: capture.viewportName, err: error },
            "capture failed for flaky story (non-blocking)",
          );
        } else {
          failedStoryIds.add(capture.story.id);
        }
        ctx.logger?.error(
          { storyId: capture.story.id, viewport: capture.viewportName, err: error },
          "capture failed for story",
        );
      }
    }),
  );
  // Also log flaky render failures as warnings
  for (const id of flakyIds) {
    if (!failedStoryIds.has(id)) {
      ctx.logger?.warn({ storyId: id }, "flaky story failed (non-blocking)");
    }
  }
  await finalize(ctx, new Set(ctx.captures.map((c) => c.story.id)), failedStoryIds, flakyIds);
}

function viewportByName(ctx: CaptureContext, name: string): Viewport {
  return ctx.viewports.find((v) => v.name === name) ?? { name, width: 0, height: 0 };
}

async function persistSnapshot(ctx: CaptureContext, capture: RenderedSnapshot): Promise<void> {
  const viewport = viewportByName(ctx, capture.viewportName);
  const screenshot = screenshotPath(
    ctx.project.id,
    ctx.build.id,
    capture.story.id,
    capture.viewportName,
  );
  await ctx.storage.write(screenshot, capture.screenshot);

  const baseline = await resolveBaseline(ctx, capture.story.id, capture.viewportName);
  if (!baseline) {
    await createWithoutBaseline(ctx, capture, viewport, screenshot);
    return;
  }
  await createWithBaseline(ctx, capture, viewport, screenshot, baseline.screenshotPath);
}

async function resolveBaseline(
  ctx: CaptureContext,
  storyId: string,
  viewport: string,
): Promise<Baseline | null> {
  const baselines = new BaselineModel(ctx.db, ctx.storage);
  return await baselines.resolve(
    ctx.project.id,
    storyId,
    viewport,
    ctx.build.gitBranch,
    ctx.project.gitDefaultBranch,
  );
}

async function createWithoutBaseline(
  ctx: CaptureContext,
  capture: RenderedSnapshot,
  viewport: Viewport,
  screenshot: string,
): Promise<void> {
  const snapshots = new SnapshotModel(ctx.db);
  const status = ctx.build.isDefault ? "approved" : "new";
  const snapshot = await snapshots.create(ctx.project.id, ctx.build.id, {
    storyId: capture.story.id,
    storyName: capture.story.name,
    storyTitle: capture.story.title,
    storyImportPath: capture.story.importPath ?? "",
    viewportName: capture.viewportName,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    screenshotPath: screenshot,
  });
  await snapshots.setStatus(snapshot.id, status);

  if (ctx.build.isDefault) {
    const baselines = new BaselineModel(ctx.db, ctx.storage);
    await baselines.upsert(
      ctx.project.id,
      capture.story.id,
      capture.viewportName,
      ctx.build.gitBranch,
      snapshot.id,
      screenshot,
    );
  }
}

async function createWithBaseline(
  ctx: CaptureContext,
  capture: RenderedSnapshot,
  viewport: Viewport,
  screenshot: string,
  baselinePath: string,
): Promise<void> {
  const current = await ctx.storage.read(screenshot);
  const previous = await ctx.storage.read(baselinePath);
  const options = {
    ...DEFAULT_DIFF_OPTIONS,
    pixelThreshold: ctx.project.pixelThreshold,
    maxDiffRatio: ctx.project.maxDiffRatio,
  };
  const result = diffImages(previous, current, options);

  const snapshots = new SnapshotModel(ctx.db);
  const snapshot = await snapshots.create(ctx.project.id, ctx.build.id, {
    storyId: capture.story.id,
    storyName: capture.story.name,
    storyTitle: capture.story.title,
    storyImportPath: capture.story.importPath ?? "",
    viewportName: capture.viewportName,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    screenshotPath: screenshot,
  });

  const status = result.passed ? "unchanged" : "changed";
  const diff = diffPath(ctx.project.id, ctx.build.id, capture.story.id, capture.viewportName);
  if (!result.passed && result.diffImage) {
    await ctx.storage.write(diff, result.diffImage);
  }
  await snapshots.update(snapshot.id, {
    status,
    diffPath: !result.passed && result.diffImage ? diff : null,
    diffPixels: result.diffPixels,
    diffRatio: result.diffRatio,
    diffPassed: result.passed,
  });
}

async function finalize(
  ctx: CaptureContext,
  storyIds: ReadonlySet<string>,
  failedStoryIds: ReadonlySet<string>,
  flakyFailedStoryIds: ReadonlySet<string> = new Set(),
): Promise<void> {
  const builds = new BuildModel(ctx.db);
  const build = await builds.updateCounts(ctx.build.id);
  const hasCaptures = storyIds.size > 0;
  let status: BuildStatus = "reviewing";
  if (failedStoryIds.size > 0) {
    status = "failed";
  } else if (hasCaptures && build.changedCount === 0) {
    status = "approved";
  }
  // Flaky failures do not block: log warning if any flaky stories failed
  if (flakyFailedStoryIds.size > 0 && failedStoryIds.size === 0) {
    ctx.logger?.warn(
      { flakyStoryIds: [...flakyFailedStoryIds] },
      "flaky stories failed (non-blocking)",
    );
  }
  await builds.setStatus(ctx.build.id, status);

  if (ctx.build.isDefault && hasCaptures) {
    const baselines = new BaselineModel(ctx.db, ctx.storage);
    await baselines.removeOrphans(ctx.project.id, new Set(storyIds));
  }
}
