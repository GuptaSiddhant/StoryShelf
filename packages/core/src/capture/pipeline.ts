import type { Logger } from "pino";
import { DEFAULT_BROWSER, type RenderedSnapshot } from "../adapters/capture-runner.ts";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import { NO_BASELINE } from "../models/baseline-status.ts";
import { BaselineModel, type BaselineTables } from "../models/baseline.ts";
import { BuildModel, type BuildTables } from "../models/build.ts";
import { emitAttemptLog, type AttemptLogRecorder } from "../models/capture-attempt.ts";
import { SnapshotModel, type SnapshotTables } from "../models/snapshot.ts";
import type { Baseline } from "../schema/baseline.ts";
import type { Build } from "../schema/build.ts";
import type { Project } from "../schema/project.ts";
import type { BuildStatus, SnapshotStatus } from "../types.ts";
import type { SecretInput } from "../utils/encrypt.ts";
import { mapLimit } from "../utils/map-limit.ts";
import { diffPath } from "../utils/paths.ts";
import { storeScreenshot } from "../utils/screenshot-store.ts";
import type { Viewport } from "./adapter.ts";
import type { InheritedStory } from "./affected.ts";
import { diffStoredScreenshots, writeDiffOverlay } from "./diff-record.ts";
import {
  buildFingerprint,
  changedFields,
  fingerprintHash,
  mergeFingerprint,
  parseFingerprint,
  type EnvironmentChange,
  type Fingerprint,
} from "./fingerprint.ts";
import { assertScreenshotBuffer } from "./guards.ts";
import type { CaptureProgress } from "./progress.ts";

/** Snapshots persisted at once: each decodes two PNGs for the diff, so unbounded fan-out spikes memory. */
export const PERSIST_CONCURRENCY = 4;

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
  input: CaptureContext,
  renderFailedStoryIds: ReadonlySet<string> = new Set(),
  flakyFailedStoryIds: ReadonlySet<string> = new Set(),
  a11yFailedStoryIds: ReadonlySet<string> = new Set(),
): Promise<void> {
  const sets = await persistRendered(
    input,
    renderFailedStoryIds,
    flakyFailedStoryIds,
    a11yFailedStoryIds,
  );
  for (const id of await persistInherited(input)) {
    sets.failed.add(id);
  }
  await finalizeBuild(input, allStoryIds(input), sets.failed, sets.flaky, sets.a11y);
}

/** Blocking, flaky and a11y story ids a persist run ended with. */
export interface PersistedSets {
  failed: Set<string>;
  flaky: Set<string>;
  a11y: Set<string>;
}

/**
 * Persist the rendered captures only: screenshots, diffs and snapshot rows, without the
 * inherited snapshots or the build finalize. A sharded capture runs this once per shard.
 */
export async function persistRendered(
  input: CaptureContext,
  renderFailedStoryIds: ReadonlySet<string> = new Set(),
  flakyFailedStoryIds: ReadonlySet<string> = new Set(),
  a11yFailedStoryIds: ReadonlySet<string> = new Set(),
): Promise<PersistedSets> {
  const ctx = await withFreshBrowsers(input);
  const failedStoryIds = new Set(renderFailedStoryIds);
  const flakyIds = new Set(flakyFailedStoryIds);
  const a11yIds = new Set(a11yFailedStoryIds);
  // Primary engine first: a newly enabled engine bootstraps from its counterpart.
  for (const group of capturesByPhase(ctx)) {
    // oxlint-disable-next-line no-await-in-loop -- phases must run in order
    await mapLimit(group, PERSIST_CONCURRENCY, async (capture) => {
      try {
        await persistSnapshot(ctx, capture);
        // Each diff is progress: a long, healthy persist phase must not read as a hung job.
        ctx.progress?.();
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
          await emitAttemptLog(
            ctx.recordLog,
            ctx.logger,
            "warn",
            "capture failed for flaky/a11y story (non-blocking)",
            {
              storyId: capture.story.id,
              viewport: capture.viewportName,
            },
          );
        } else {
          failedStoryIds.add(capture.story.id);
        }
        ctx.logger?.error(
          { storyId: capture.story.id, viewport: capture.viewportName, err: error },
          "capture failed for story",
        );
        await emitAttemptLog(ctx.recordLog, ctx.logger, "error", "capture failed for story", {
          storyId: capture.story.id,
          viewport: capture.viewportName,
        });
      }
    });
  }
  // Also log flaky and a11y render failures as warnings
  for (const id of flakyIds) {
    if (!failedStoryIds.has(id)) {
      ctx.logger?.warn({ storyId: id }, "flaky story failed (non-blocking)");
      await emitAttemptLog(ctx.recordLog, ctx.logger, "warn", "flaky story failed (non-blocking)", {
        storyId: id,
      });
    }
  }
  for (const id of a11yIds) {
    if (!failedStoryIds.has(id) && !flakyIds.has(id)) {
      ctx.logger?.warn({ storyId: id }, "a11y violations found (non-blocking)");
      await emitAttemptLog(
        ctx.recordLog,
        ctx.logger,
        "warn",
        "a11y violations found (non-blocking)",
        {
          storyId: id,
        },
      );
    }
  }
  return { failed: failedStoryIds, flaky: flakyIds, a11y: a11yIds };
}

/** Engines of this run, primary (first) first. */
function runBrowsers(ctx: CaptureContext): string[] {
  const listed = ctx.browsers && ctx.browsers.length > 0 ? ctx.browsers : [DEFAULT_BROWSER];
  return [...new Set(listed)];
}

function primaryBrowser(ctx: CaptureContext): string {
  return runBrowsers(ctx)[0] ?? DEFAULT_BROWSER;
}

function browserOf(capture: { browser?: string }): string {
  return capture.browser ?? DEFAULT_BROWSER;
}

/** Captures split into the primary engine's, then everyone else's. */
function capturesByPhase(ctx: CaptureContext): RenderedSnapshot[][] {
  const primary = primaryBrowser(ctx);
  const first = ctx.captures.filter((capture) => browserOf(capture) === primary);
  const rest = ctx.captures.filter((capture) => browserOf(capture) !== primary);
  return rest.length > 0 ? [first, rest] : [first];
}

/** Secondary engines with no baseline yet (their first snapshots bootstrap from the primary). */
export async function freshBrowsersOf(ctx: CaptureContext): Promise<Set<string>> {
  const primary = primaryBrowser(ctx);
  const baselines = new BaselineModel(ctx.db, ctx.tables, ctx.storage, ctx.secret);
  const secondary = runBrowsers(ctx).filter((browser) => browser !== primary);
  const checks = await Promise.all(
    secondary.map(async (browser) => ({
      browser,
      fresh: !(await baselines.hasAny(ctx.project.id, browser)),
    })),
  );
  return new Set(checks.filter((check) => check.fresh).map((check) => check.browser));
}

/** Mark secondary engines with no baseline yet: their first snapshots bootstrap. */
async function withFreshBrowsers(ctx: CaptureContext): Promise<CaptureContext> {
  return ctx.freshBrowsers ? ctx : { ...ctx, freshBrowsers: await freshBrowsersOf(ctx) };
}

/**
 * A newly enabled engine accepts a story/mode's first snapshot when the
 * primary engine's snapshot of it is clean (Chromatic's "auto-accepted where
 * the primary browser was accepted"); anything else goes to review as `new`.
 */
async function bootstrapAccepts(ctx: CaptureContext, capture: RenderedSnapshot): Promise<boolean> {
  const browser = browserOf(capture);
  if (!ctx.freshBrowsers?.has(browser)) return false;
  const primary = primaryBrowser(ctx);
  const siblings = await new SnapshotModel(ctx.db, ctx.tables).listByBuild(ctx.build.id);
  return siblings.some(
    (snapshot) =>
      snapshot.storyId === capture.story.id &&
      snapshot.viewportName === capture.viewportName &&
      (snapshot.browser ?? DEFAULT_BROWSER) === primary &&
      (snapshot.status === "approved" || snapshot.status === "unchanged"),
  );
}

/** Persist one inherited snapshot; returns the story id on failure. */
async function tryPersistInherited(
  ctx: CaptureContext,
  inherited: InheritedStory,
): Promise<string | null> {
  try {
    await persistInheritedSnapshot(ctx, inherited);
    return null;
  } catch (error) {
    ctx.logger?.error(
      { storyId: inherited.story.id, viewport: inherited.viewport.name, err: error },
      "inherit failed for story",
    );
    await emitAttemptLog(ctx.recordLog, ctx.logger, "error", "inherit failed for story", {
      storyId: inherited.story.id,
      viewport: inherited.viewport.name,
    });
    return inherited.story.id;
  }
}

/** Persist inherited snapshots; a failure marks the story failed. */
/** Persist the inherited snapshots (stories reusing their baseline); returns the story ids that failed. */
export async function persistInherited(ctx: CaptureContext): Promise<ReadonlySet<string>> {
  const outcomes = await mapLimit(ctx.inherited ?? [], PERSIST_CONCURRENCY, async (inherited) => {
    const failed = await tryPersistInherited(ctx, inherited);
    ctx.progress?.();
    return failed;
  });
  return new Set(outcomes.filter((id): id is string => id !== null));
}

/** Create an unchanged snapshot reusing the baseline screenshot. */
async function persistInheritedSnapshot(
  ctx: CaptureContext,
  inherited: InheritedStory,
): Promise<void> {
  const browser = browserOf(inherited);
  // Nothing rendered, so there is no new fingerprint: the snapshot carries the baseline's.
  const infraHash = inherited.baseline.infraHash;
  const snapshots = new SnapshotModel(ctx.db, ctx.tables);
  const snapshot = await snapshots.create(ctx.project.id, ctx.build.id, {
    browser,
    storyId: inherited.story.id,
    storyName: inherited.story.name,
    storyTitle: inherited.story.title,
    storyImportPath: inherited.story.importPath ?? "",
    designUrl: inherited.story.designUrl ?? null,
    viewportName: inherited.viewport.name,
    viewportWidth: inherited.viewport.width,
    viewportHeight: inherited.viewport.height,
    screenshotPath: inherited.baseline.screenshotPath,
    infraHash,
    mode: modeJsonOf(inherited.viewport),
    inherited: true,
    baselineId: inherited.baseline.id,
    baselineVersion: inherited.baseline.updatedAt,
  });
  await snapshots.update(snapshot.id, {
    status: "unchanged",
    diffPixels: 0,
    diffRatio: 0,
    diffPassed: true,
    diffPath: null,
    infraHash,
  });
}

/** Every story covered by a capture run, rendered or inherited. */
function allStoryIds(ctx: CaptureContext): ReadonlySet<string> {
  const ids = new Set(ctx.captures.map((capture) => capture.story.id));
  for (const inherited of ctx.inherited ?? []) {
    ids.add(inherited.story.id);
  }
  return ids;
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
  /** Engines captured this run, primary first (default: chromium only). */
  browsers?: string[];
  /** Secondary engines with no baselines yet; worked out by `persistCapture`, or fixed up front by a shard plan. */
  freshBrowsers?: ReadonlySet<string>;
  /** Screenshot buffers produced by the capture renderer. */
  captures: RenderedSnapshot[];
  /** Stories inheriting their baseline without rendering (affected capture). */
  inherited?: InheritedStory[];
  /** Optional logger for capture diagnostics. */
  logger?: Logger;
  /** Optional per-attempt log recorder (mirrors logger lines into the DB). */
  recordLog?: AttemptLogRecorder;
  /** Called per snapshot persisted, so the job's lease sees a long diff phase making progress. */
  progress?: CaptureProgress | undefined;
  /** Server secret for decrypting webhook secrets at send time. */
  secret?: SecretInput;
}

/** JSON for the snapshot `mode` column: the globals a mode applied (null for plain viewports). */
function modeJsonOf(viewport: Viewport | undefined): string | null {
  return viewport?.globals ? JSON.stringify(viewport.globals) : null;
}

function viewportByName(ctx: CaptureContext, name: string): Viewport {
  return ctx.viewports.find((v) => v.name === name) ?? { name, width: 0, height: 0 };
}

/** Where the capture's screenshot lives: already stored by the orchestrator, or stored now. */
async function screenshotLocation(ctx: CaptureContext, capture: RenderedSnapshot): Promise<string> {
  if (capture.storedPath) {
    return capture.storedPath;
  }
  assertScreenshotBuffer(capture.screenshot);
  return await storeScreenshot(ctx.storage, ctx.project.id, capture.screenshot);
}

async function persistSnapshot(ctx: CaptureContext, capture: RenderedSnapshot): Promise<void> {
  const viewport = capture.viewport ?? viewportByName(ctx, capture.viewportName);
  const browser = browserOf(capture);
  const screenshot = await screenshotLocation(ctx, capture);

  const baseline = await resolveBaseline(ctx, capture.story.id, capture.viewportName, browser);
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
  browser: string,
): Promise<Baseline | null> {
  const baselines = new BaselineModel(ctx.db, ctx.tables, ctx.storage, ctx.secret);
  return await baselines.resolve(
    ctx.project.id,
    storyId,
    viewport,
    ctx.build.gitBranch,
    ctx.project.gitDefaultBranch,
    browser,
  );
}

async function createWithoutBaseline(
  ctx: CaptureContext,
  capture: RenderedSnapshot,
  viewport: Viewport,
  screenshot: string,
): Promise<void> {
  const snapshots = new SnapshotModel(ctx.db, ctx.tables);
  const browser = browserOf(capture);
  const accepted = ctx.build.isDefault || (await bootstrapAccepts(ctx, capture));
  const status = accepted ? "approved" : "new";
  const now = fingerprintOf(capture, viewport);
  const snapshot = await snapshots.create(ctx.project.id, ctx.build.id, {
    browser,
    durationMs: capture.durationMs ?? null,
    storyId: capture.story.id,
    storyName: capture.story.name,
    storyTitle: capture.story.title,
    storyImportPath: capture.story.importPath ?? "",
    designUrl: capture.story.designUrl ?? null,
    viewportName: capture.viewportName,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    screenshotPath: screenshot,
    infraHash: now.infraHash,
    mode: modeJsonOf(viewport),
    baselineVersion: NO_BASELINE,
  });
  await snapshots.setStatus(snapshot.id, status);

  if (accepted) {
    const baselines = new BaselineModel(ctx.db, ctx.tables, ctx.storage, ctx.secret);
    await baselines.upsert(
      ctx.project.id,
      capture.story.id,
      capture.viewportName,
      ctx.build.gitBranch,
      snapshot.id,
      screenshot,
      now.infraHash,
      { mode: modeJsonOf(viewport), browser, fingerprint: now.json },
    );
  }
}

/** A capture's fingerprint: its components, their hash (stored as `infraHash`), and the stored JSON. */
interface CaptureFingerprint {
  fingerprint: Fingerprint;
  infraHash: string;
  json: string;
}

function fingerprintOf(capture: RenderedSnapshot, viewport: Viewport): CaptureFingerprint {
  return captureFingerprintOf(buildFingerprint(browserOf(capture), viewport, capture.environment));
}

/** A fingerprint as stored: its hash (the `infraHash`) and JSON. */
function captureFingerprintOf(fingerprint: Fingerprint): CaptureFingerprint {
  return {
    fingerprint,
    infraHash: fingerprintHash(fingerprint),
    json: JSON.stringify(fingerprint),
  };
}

/**
 * What changed in the capture environment since the baseline was recorded, or null when nothing
 * did. Compared component by component, only where both sides report a value: a capture with no
 * environment (spooled before a browser crash) is unknown, not a change. A baseline from before
 * fingerprints cannot be compared, so it is never reported as changed; it is backfilled instead.
 */
function environmentChange(baseline: Baseline, now: CaptureFingerprint): EnvironmentChange | null {
  const from = parseFingerprint(baseline.fingerprint);
  if (!from) {
    return null;
  }
  const changed = changedFields(from, now.fingerprint);
  return changed.length > 0 ? { changed, from, to: now.fingerprint } : null;
}

/**
 * A changed environment migrates the baseline without a diff only on the default branch, which is
 * authoritative and auto-approves its own changes anyway. A feature branch still diffs: a real
 * change is reported as `changed` with the environment change attached, never auto-accepted.
 */
async function createWithBaseline(
  ctx: CaptureContext,
  capture: RenderedSnapshot,
  viewport: Viewport,
  screenshot: string,
  baseline: Baseline,
): Promise<void> {
  const now = fingerprintOf(capture, viewport);
  const change = environmentChange(baseline, now);
  const input = { ctx, capture, viewport, screenshot, baseline, now, change };
  if (change && ctx.build.isDefault) {
    await persistMigration(input, change);
  } else {
    await persistDiff(input);
  }
}

interface BaselineCapture {
  ctx: CaptureContext;
  capture: RenderedSnapshot;
  viewport: Viewport;
  screenshot: string;
  baseline: Baseline;
  now: CaptureFingerprint;
  change: EnvironmentChange | null;
}

/** The fingerprint to write on the baseline: the capture's, keeping components it did not report. */
function baselineFingerprintOf(input: BaselineCapture): CaptureFingerprint {
  const earlier = parseFingerprint(input.baseline.fingerprint);
  return captureFingerprintOf(mergeFingerprint(earlier, input.now.fingerprint));
}

function snapshotInput(input: BaselineCapture): Parameters<SnapshotModel["create"]>[2] {
  const { capture, viewport, screenshot, baseline, now } = input;
  return {
    browser: browserOf(capture),
    durationMs: capture.durationMs ?? null,
    storyId: capture.story.id,
    storyName: capture.story.name,
    storyTitle: capture.story.title,
    storyImportPath: capture.story.importPath ?? "",
    designUrl: capture.story.designUrl ?? null,
    viewportName: capture.viewportName,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    screenshotPath: screenshot,
    infraHash: now.infraHash,
    mode: modeJsonOf(viewport),
    baselineId: baseline.id,
    baselineVersion: baseline.updatedAt,
  };
}

/**
 * The default branch's capture environment changed (browser build, fonts, platform, scale): pixels
 * would differ with no code change, so no diff is computed. The snapshot is accepted, records what
 * changed, and the new screenshot becomes the baseline.
 */
async function persistMigration(input: BaselineCapture, change: EnvironmentChange): Promise<void> {
  const { ctx, capture, viewport, screenshot, now } = input;
  const snapshots = new SnapshotModel(ctx.db, ctx.tables);
  const snapshot = await snapshots.create(ctx.project.id, ctx.build.id, {
    ...snapshotInput(input),
    envChange: JSON.stringify(change),
  });
  await snapshots.update(snapshot.id, {
    status: "unchanged",
    diffPath: null,
    diffPixels: 0,
    diffRatio: 0,
    diffPassed: true,
    infraHash: now.infraHash,
  });
  await upsertDefaultBaseline(ctx, snapshot.id, capture, screenshot, baselineFingerprintOf(input));
  ctx.logger?.debug(
    { storyId: capture.story.id, viewport: viewport.name, changed: change.changed },
    "capture environment changed; accepted without a diff",
  );
}

/** Diff against the baseline; a feature-branch environment change rides along as `envChange`. */
async function persistDiff(input: BaselineCapture): Promise<void> {
  const { ctx, capture, screenshot, baseline, now, change } = input;
  const result = await diffStoredScreenshots(
    ctx.storage,
    ctx.project,
    baseline.screenshotPath,
    screenshot,
    capture.story.parameters?.diffThreshold,
  );
  const snapshots = new SnapshotModel(ctx.db, ctx.tables);
  const snapshot = await snapshots.create(ctx.project.id, ctx.build.id, {
    ...snapshotInput(input),
    ...(change ? { envChange: JSON.stringify(change) } : {}),
  });
  const diff = diffPath(
    ctx.project.id,
    ctx.build.id,
    capture.story.id,
    capture.viewportName,
    browserOf(capture),
  );
  const overlay = await writeDiffOverlay(ctx.storage, diff, result, result.passed);
  await snapshots.update(snapshot.id, {
    status: diffStatus(result.passed, ctx.build.isDefault),
    diffPath: overlay,
    diffPixels: result.diffPixels,
    diffRatio: result.diffRatio,
    diffPassed: result.passed,
    infraHash: now.infraHash,
  });
  if (ctx.build.isDefault) {
    await refreshDefaultBaseline(input, snapshot.id, result.passed);
  }
}

/**
 * After a default-branch diff: a failed diff moves the baseline to the new screenshot; a passing
 * one backfills the fingerprint when it was missing or had components the capture now reports.
 */
async function refreshDefaultBaseline(
  input: BaselineCapture,
  snapshotId: string,
  passed: boolean,
): Promise<void> {
  const { ctx, capture, screenshot, baseline } = input;
  const target = baselineFingerprintOf(input);
  if (!passed) {
    await upsertDefaultBaseline(ctx, snapshotId, capture, screenshot, target);
  } else if (!baseline.fingerprint || baseline.infraHash !== target.infraHash) {
    await new BaselineModel(ctx.db, ctx.tables, ctx.storage, ctx.secret).backfillFingerprint(
      baseline,
      target.infraHash,
      target.json,
    );
  }
}

/** Default-branch builds are authoritative: the captured screenshot becomes the baseline. */
async function upsertDefaultBaseline(
  ctx: CaptureContext,
  snapshotId: string,
  capture: RenderedSnapshot,
  screenshot: string,
  now: CaptureFingerprint,
): Promise<void> {
  const baselines = new BaselineModel(ctx.db, ctx.tables, ctx.storage, ctx.secret);
  await baselines.upsert(
    ctx.project.id,
    capture.story.id,
    capture.viewportName,
    ctx.build.gitBranch,
    snapshotId,
    screenshot,
    now.infraHash,
    { mode: modeJsonOf(capture.viewport), browser: browserOf(capture), fingerprint: now.json },
  );
}

/** Snapshot status after diffing: default-branch changes are auto-approved, not queued for review. */
export function diffStatus(passed: boolean, isDefault: boolean): SnapshotStatus {
  if (passed) {
    return "unchanged";
  }
  return isDefault ? "approved" : "changed";
}

/** A failed capture fails the build; default-branch builds otherwise auto-approve. */
function finalBuildStatus(
  isDefault: boolean,
  failedCount: number,
  hasCaptures: boolean,
  build: { changedCount: number },
): BuildStatus {
  if (failedCount > 0) {
    return "failed";
  }
  if (isDefault || (hasCaptures && build.changedCount === 0)) {
    return "approved";
  }
  return "reviewing";
}

/**
 * Close out a capture: roll the snapshot counts up, set the build's final status from the failed
 * story ids, and (on the default branch) drop baselines of stories that no longer exist.
 */
export async function finalizeBuild(
  ctx: CaptureContext,
  storyIds: ReadonlySet<string>,
  failedStoryIds: ReadonlySet<string>,
  flakyFailedStoryIds: ReadonlySet<string> = new Set(),
  a11yFailedStoryIds: ReadonlySet<string> = new Set(),
): Promise<void> {
  const builds = new BuildModel(ctx.db, ctx.tables);
  const build = await builds.updateCounts(ctx.build.id);
  const hasCaptures = storyIds.size > 0;
  const status = finalBuildStatus(ctx.build.isDefault, failedStoryIds.size, hasCaptures, build);
  // Flaky and a11y failures do not block: log warning if any failed non-blocking
  if (flakyFailedStoryIds.size > 0 && failedStoryIds.size === 0) {
    ctx.logger?.warn(
      { flakyStoryIds: [...flakyFailedStoryIds] },
      "flaky stories failed (non-blocking)",
    );
    await emitAttemptLog(ctx.recordLog, ctx.logger, "warn", "flaky stories failed (non-blocking)", {
      flakyStoryIds: [...flakyFailedStoryIds],
    });
  }
  if (a11yFailedStoryIds.size > 0 && failedStoryIds.size === 0) {
    ctx.logger?.warn(
      { a11yStoryIds: [...a11yFailedStoryIds] },
      "a11y violations found (non-blocking)",
    );
    await emitAttemptLog(
      ctx.recordLog,
      ctx.logger,
      "warn",
      "a11y violations found (non-blocking)",
      {
        a11yStoryIds: [...a11yFailedStoryIds],
      },
    );
  }
  await builds.setStatus(ctx.build.id, status);

  if (ctx.build.isDefault && hasCaptures) {
    const baselines = new BaselineModel(ctx.db, ctx.tables, ctx.storage, ctx.secret);
    await baselines.removeOrphans(ctx.project.id, new Set(storyIds));
  }
}
