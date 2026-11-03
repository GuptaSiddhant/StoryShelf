/**
 * Unstable-render detection: a snapshot that differs from its baseline is rendered once more, and
 * flagged when the two renders differ from each other (a likely flaky story). Advisory only: the
 * snapshot stays `changed`, the build and git state are untouched, and render 1 is the one kept.
 */
import type { CaptureTarget, RenderedSnapshot } from "../adapters/capture-runner.ts";
import { isCaptureTarget } from "../adapters/capture-target.ts";
import { BuildModel } from "../models/build.ts";
import { emitAttemptLog } from "../models/capture-attempt.ts";
import { SnapshotModel } from "../models/snapshot.ts";
import type { Snapshot } from "../schema/snapshot.ts";
import { storeScreenshot } from "../utils/screenshot-store.ts";
import type { StoryEntry } from "./adapter.ts";
import { diffStoredScreenshots } from "./diff-record.ts";
import { renderWork, type MatrixInput } from "./matrix.ts";

/** What a stability pass found. */
export interface StabilityOutcome {
  /** Changed snapshots whose second render was compared with the first. */
  compared: number;
  /** Of those, how many differed (flagged `unstable`). */
  unstable: number;
  /** Changed snapshots the second render could not produce; left unflagged. */
  missed: number;
}

/** Identity of a (engine, story) pair, to scope a pass to one shard's slice. */
export function stabilityKey(browser: string, storyId: string): string {
  return `${browser}\u0000${storyId}`;
}

const snapshotKey = (snapshot: Pick<Snapshot, "storyId" | "viewportName" | "browser">): string =>
  `${snapshot.browser ?? "chromium"}\u0000${snapshot.storyId}\u0000${snapshot.viewportName}`;

/**
 * The snapshots worth a second render: a diff that failed on a branch build (so it waits for
 * review), rendered here, and not yet judged. Default-branch changes are auto-approved, inherited
 * snapshots were not rendered, and a snapshot already judged is never rendered again.
 */
export function stabilityCandidates(
  snapshots: readonly Snapshot[],
  scope?: ReadonlySet<string>,
): Snapshot[] {
  return snapshots.filter(
    (snapshot) =>
      snapshot.status === "changed" &&
      snapshot.diffPassed === false &&
      !snapshot.inherited &&
      (snapshot.unstable ?? null) === null &&
      (scope?.has(stabilityKey(snapshot.browser ?? "chromium", snapshot.storyId)) ?? true),
  );
}

/** One render call: the stories of an engine that share the same changed viewports. */
interface Batch {
  browser: CaptureTarget;
  viewportNames: ReadonlySet<string>;
  stories: StoryEntry[];
}

/** Group candidates into render calls, so each changed (story, viewport) is rendered once. */
export function batchesOf(
  candidates: readonly Snapshot[],
  stories: readonly StoryEntry[],
): Batch[] {
  const wanted = Map.groupBy(candidates, (snapshot) => snapshot.browser ?? "chromium");
  const byId = new Map(stories.map((story) => [story.id, story] as const));
  return [...wanted].flatMap(([browser, rows]) => {
    if (!isCaptureTarget(browser)) return [];
    const names = Map.groupBy(rows, (row) => row.storyId);
    const sets = Map.groupBy([...names], ([, viewports]) =>
      viewports
        .map((row) => row.viewportName)
        .toSorted()
        .join("\u0000"),
    );
    return [...sets.values()].map((group): Batch => {
      const first = group[0]?.[1] ?? [];
      return {
        browser,
        viewportNames: new Set(first.map((row) => row.viewportName)),
        stories: group.flatMap(([id]) => byId.get(id) ?? []),
      };
    });
  });
}

/**
 * Re-render the changed snapshots of this pass once and flag those that differ from their first
 * render. Never throws on a failed second render (the first one succeeded): it only leaves the
 * snapshot unflagged. A cancelled build still stops.
 */
export async function detectUnstableRenders(
  input: MatrixInput,
  scope?: ReadonlySet<string>,
): Promise<StabilityOutcome> {
  const outcome: StabilityOutcome = { compared: 0, unstable: 0, missed: 0 };
  if (input.project.detectUnstable === false) return outcome;
  const snapshots = new SnapshotModel(input.db, input.tables);
  const candidates = stabilityCandidates(await snapshots.listByBuild(input.build.id), scope);
  const rows = new Map(candidates.map((snapshot) => [snapshotKey(snapshot), snapshot] as const));
  for (const batch of batchesOf(candidates, input.stories)) {
    // oxlint-disable-next-line no-await-in-loop -- one render call at a time, like every pass
    await judgeBatch(input, snapshots, rows, batch, outcome);
  }
  outcome.missed = candidates.length - outcome.compared;
  if (candidates.length > 0) await report(input, outcome);
  return outcome;
}

async function judgeBatch(
  input: MatrixInput,
  snapshots: SnapshotModel,
  rows: ReadonlyMap<string, Snapshot>,
  batch: Batch,
  outcome: StabilityOutcome,
): Promise<void> {
  const viewports = input.viewports.filter((viewport) => batch.viewportNames.has(viewport.name));
  try {
    const rendered = await renderWork(
      {
        ...input,
        // The second render's accessibility results are never read, so skip axe on it.
        project: { ...input.project, runA11y: false },
        stories: batch.stories,
        viewports: viewports.length > 0 ? viewports : input.viewports,
      },
      [{ browser: batch.browser, stories: batch.stories }],
    );
    await judgeCaptures(input, snapshots, rows, rendered.captures, outcome);
  } catch (error) {
    await rethrowIfCancelled(input, error);
    input.logger?.warn({ err: error, browser: batch.browser }, "second render failed; not judged");
  }
}

/** Compare each second render with its first and record the verdict on the snapshot. */
async function judgeCaptures(
  input: MatrixInput,
  snapshots: SnapshotModel,
  rows: ReadonlyMap<string, Snapshot>,
  captures: readonly RenderedSnapshot[],
  outcome: StabilityOutcome,
): Promise<void> {
  for (const capture of captures) {
    const row = rows.get(snapshotKey({ ...capture, storyId: capture.story.id }));
    if (!row) continue;
    // oxlint-disable-next-line no-await-in-loop -- each diff decodes two PNGs; keep memory flat
    const unstable = await differs(input, row, capture);
    // oxlint-disable-next-line no-await-in-loop -- one write per judged snapshot
    await snapshots.update(row.id, { unstable });
    outcome.compared += 1;
    outcome.unstable += unstable ? 1 : 0;
  }
}

/** Whether the second render differs from the stored first render beyond the diff threshold. */
async function differs(
  input: MatrixInput,
  row: Snapshot,
  capture: RenderedSnapshot,
): Promise<boolean> {
  const result = await diffStoredScreenshots(
    input.storage,
    input.project,
    row.screenshotPath,
    await storedPathOf(input, capture),
    capture.story.parameters?.diffThreshold,
  );
  return !result.passed;
}

/** Where render 2 is stored: spooled captures already are; a runner that returns its bytes is stored now. */
async function storedPathOf(input: MatrixInput, capture: RenderedSnapshot): Promise<string> {
  return (
    capture.storedPath ??
    (await storeScreenshot(input.storage, input.project.id, capture.screenshot))
  );
}

/** A cancel must stop the capture; any other failure only leaves the snapshots unjudged. */
async function rethrowIfCancelled(input: MatrixInput, error: unknown): Promise<void> {
  const build = await new BuildModel(input.db, input.tables).get(input.build.id);
  if (build?.status === "cancelled") throw error;
}

async function report(input: MatrixInput, outcome: StabilityOutcome): Promise<void> {
  const level = outcome.unstable > 0 ? "warn" : "info";
  input.logger?.[level](outcome, "stability pass finished");
  await emitAttemptLog(input.recordLog, input.logger, level, "stability pass finished", {
    ...outcome,
  });
}
