import type { Logger } from "pino";
import type { RenderedSnapshot } from "../adapters/capture-runner.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import type { DatabaseAdapter } from "../db/database.ts";
import { diffImages } from "../diff/engine.ts";
import { DEFAULT_DIFF_OPTIONS } from "../diff/options.ts";
import { BaselineModel, type BaselineTables } from "../models/baseline.ts";
import { BuildModel, type BuildTables } from "../models/build.ts";
import { SnapshotModel, type SnapshotTables } from "../models/snapshot.ts";
import type { Baseline } from "../schema/baseline.ts";
import type { Build } from "../schema/build.ts";
import type { Project } from "../schema/project.ts";
import type { BuildStatus } from "../types.ts";
import { diffPath, screenshotPath } from "../utils/paths.ts";
import type { Viewport } from "./adapter.ts";
import { infraHashFor, SIZING_DEFAULTS } from "./sizing.ts";

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
  a11yFailedStoryIds: ReadonlySet<string> = new Set(),
): Promise<void> {
  const failedStoryIds = new Set(renderFailedStoryIds);
  const flakyIds = new Set(flakyFailedStoryIds);
  const a11yIds = new Set(a11yFailedStoryIds);
  await Promise.all(
    ctx.captures.map(async (capture) => {
      try {
        await persistSnapshot(ctx, capture);
      } catch (error) {
        // A failure in one story/viewport must not abort the other persists.
        // Flaky and a11y stories remain non-blocking even on persist failure.
        if (flakyIds.has(capture.story.id) || a11yIds.has(capture.story.id)) {
          if (flakyIds.has(capture.story.id)) flakyIds.add(capture.story.id);
          if (a11yIds.has(capture.story.id)) a11yIds.add(capture.story.id);
          ctx.logger?.warn(
            { storyId: capture.story.id, viewport: capture.viewportName, err: error },
            "capture failed for flaky/a11y story (non-blocking)",
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
  // Also log flaky and a11y render failures as warnings
  for (const id of flakyIds) {
    if (!failedStoryIds.has(id)) {
      ctx.logger?.warn({ storyId: id }, "flaky story failed (non-blocking)");
    }
  }
  for (const id of a11yIds) {
    if (!failedStoryIds.has(id) && !flakyIds.has(id)) {
      ctx.logger?.warn({ storyId: id }, "a11y violations found (non-blocking)");
    }
  }
  await finalize(
    ctx,
    new Set(ctx.captures.map((c) => c.story.id)),
    failedStoryIds,
    flakyIds,
    a11yIds,
  );
}

/** Table handles required by the capture pipeline. */
export type PipelineTables = BuildTables & BaselineTables & SnapshotTables;

/** Persistence inputs for a completed capture run. */
export interface CaptureContext {
  /** Database adapter. */
  db: DatabaseAdapter;
  /** Table handles. */
  tables: PipelineTables;
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
  /** Server secret for decrypting webhook secrets at send time. */
  secret?: string | undefined;
}

function viewportByName(ctx: CaptureContext, name: string): Viewport {
  return ctx.viewports.find((v) => v.name === name) ?? { name, width: 0, height: 0 };
}

async function persistSnapshot(ctx: CaptureContext, capture: RenderedSnapshot): Promise<void> {
  const viewport = capture.viewport ?? viewportByName(ctx, capture.viewportName);
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
  await createWithBaseline(ctx, capture, viewport, screenshot, baseline);
}

async function resolveBaseline(
  ctx: CaptureContext,
  storyId: string,
  viewport: string,
): Promise<Baseline | null> {
  const baselines = new BaselineModel(ctx.db, ctx.tables, ctx.storage, ctx.secret);
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
  const snapshots = new SnapshotModel(ctx.db, ctx.tables);
  const status = ctx.build.isDefault ? "approved" : "new";
  const infraHash = infraHashFor(ctx.project.browser ?? "chromium", ctx.viewports, SIZING_DEFAULTS);
  const snapshot = await snapshots.create(ctx.project.id, ctx.build.id, {
    storyId: capture.story.id,
    storyName: capture.story.name,
    storyTitle: capture.story.title,
    storyImportPath: capture.story.importPath ?? "",
    viewportName: capture.viewportName,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    screenshotPath: screenshot,
    infraHash,
  });
  await snapshots.setStatus(snapshot.id, status);

  if (ctx.build.isDefault) {
    const baselines = new BaselineModel(ctx.db, ctx.tables, ctx.storage, ctx.secret);
    await baselines.upsert(
      ctx.project.id,
      capture.story.id,
      capture.viewportName,
      ctx.build.gitBranch,
      snapshot.id,
      screenshot,
      infraHash,
    );
  }
}

async function createWithBaseline(
  ctx: CaptureContext,
  capture: RenderedSnapshot,
  viewport: Viewport,
  screenshot: string,
  baseline: Baseline,
): Promise<void> {
  const current = await ctx.storage.read(screenshot);
  const previous = await ctx.storage.read(baseline.screenshotPath);
  const options = {
    ...DEFAULT_DIFF_OPTIONS,
    pixelThreshold: ctx.project.pixelThreshold,
    maxDiffRatio: ctx.project.maxDiffRatio,
  };
  const result = diffImages(previous, current, options);

  const infraHash = infraHashFor(ctx.project.browser ?? "chromium", ctx.viewports, SIZING_DEFAULTS);
  const snapshots = new SnapshotModel(ctx.db, ctx.tables);
  const snapshot = await snapshots.create(ctx.project.id, ctx.build.id, {
    storyId: capture.story.id,
    storyName: capture.story.name,
    storyTitle: capture.story.title,
    storyImportPath: capture.story.importPath ?? "",
    viewportName: capture.viewportName,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    screenshotPath: screenshot,
    infraHash,
  });

  // Automigrate: infra-induced size change with project.automigrate enabled
  const shouldAutomigrate =
    result.sizeChanged &&
    !result.passed &&
    (ctx.project as unknown as { automigrate?: boolean }).automigrate &&
    baseline.infraHash !== null &&
    baseline.infraHash !== infraHash;

  const status = shouldAutomigrate ? "unchanged" : result.passed ? "unchanged" : "changed";
  const diff = diffPath(ctx.project.id, ctx.build.id, capture.story.id, capture.viewportName);
  const passed = shouldAutomigrate ? true : result.passed;
  const pixels = shouldAutomigrate ? 0 : result.diffPixels;
  const ratio = shouldAutomigrate ? 0 : result.diffRatio;
  if (!passed && result.diffImage) {
    await ctx.storage.write(diff, result.diffImage);
  }
  await snapshots.update(snapshot.id, {
    status,
    diffPath: !passed && result.diffImage ? diff : null,
    diffPixels: pixels,
    diffRatio: ratio,
    diffPassed: passed,
    infraHash,
  });
  if (shouldAutomigrate && ctx.build.isDefault) {
    const baselines = new BaselineModel(ctx.db, ctx.tables, ctx.storage, ctx.secret);
    await baselines.upsert(
      ctx.project.id,
      capture.story.id,
      capture.viewportName,
      ctx.build.gitBranch,
      snapshot.id,
      screenshot,
      infraHash,
    );
  }
}

async function finalize(
  ctx: CaptureContext,
  storyIds: ReadonlySet<string>,
  failedStoryIds: ReadonlySet<string>,
  flakyFailedStoryIds: ReadonlySet<string> = new Set(),
  a11yFailedStoryIds: ReadonlySet<string> = new Set(),
): Promise<void> {
  const builds = new BuildModel(ctx.db, ctx.tables);
  const build = await builds.updateCounts(ctx.build.id);
  const hasCaptures = storyIds.size > 0;
  let status: BuildStatus = "reviewing";
  if (failedStoryIds.size > 0) {
    status = "failed";
  } else if (hasCaptures && build.changedCount === 0) {
    status = "approved";
  }
  // Flaky and a11y failures do not block: log warning if any failed non-blocking
  if (flakyFailedStoryIds.size > 0 && failedStoryIds.size === 0) {
    ctx.logger?.warn(
      { flakyStoryIds: [...flakyFailedStoryIds] },
      "flaky stories failed (non-blocking)",
    );
  }
  if (a11yFailedStoryIds.size > 0 && failedStoryIds.size === 0) {
    ctx.logger?.warn(
      { a11yStoryIds: [...a11yFailedStoryIds] },
      "a11y violations found (non-blocking)",
    );
  }
  await builds.setStatus(ctx.build.id, status);

  if (ctx.build.isDefault && hasCaptures) {
    const baselines = new BaselineModel(ctx.db, ctx.tables, ctx.storage, ctx.secret);
    await baselines.removeOrphans(ctx.project.id, new Set(storyIds));
  }
}
