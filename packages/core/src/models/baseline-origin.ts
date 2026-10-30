import { DEFAULT_BROWSER } from "../adapters/capture-runner.ts";
import type { Baseline, Build, Snapshot } from "../schema/index.ts";

/** The records needed to prove which build rendered a baseline image. */
export interface BaselineOriginReader {
  baseline(id: string): Promise<Baseline | null>;
  snapshot(id: string): Promise<Snapshot | null>;
  build(id: string): Promise<Build | null>;
}

/** A proven source, or null when the recorded history is incomplete or has changed. */
export async function resolveBaselineOrigin(
  baseline: Baseline,
  reader: BaselineOriginReader,
): Promise<Build | null> {
  return await traceOrigin(baseline, baseline.projectId, reader, new Set());
}

async function traceOrigin(
  current: Baseline,
  projectId: string,
  reader: BaselineOriginReader,
  seen: Set<string>,
): Promise<Build | null> {
  if (current.sourceBuildId) return await verifiedBuild(current.sourceBuildId, projectId, reader);
  if (seen.size >= 32 || seen.has(current.id) || !current.snapshotId) return null;
  seen.add(current.id);
  const snapshot = await reader.snapshot(current.snapshotId);
  if (!snapshot || !matchesImage(current, snapshot)) return null;
  if (!snapshot.inherited) return await verifiedBuild(snapshot.buildId, projectId, reader);
  return await traceInherited(snapshot, projectId, reader, seen);
}

async function traceInherited(
  snapshot: Snapshot,
  projectId: string,
  reader: BaselineOriginReader,
  seen: Set<string>,
): Promise<Build | null> {
  if (!snapshot.baselineId || !snapshot.baselineVersion) return null;
  const parent = await reader.baseline(snapshot.baselineId);
  if (!parent || parent.updatedAt !== snapshot.baselineVersion || !matchesImage(parent, snapshot))
    return null;
  return await traceOrigin(parent, projectId, reader, seen);
}

function matchesImage(baseline: Baseline, snapshot: Snapshot): boolean {
  return (
    baseline.projectId === snapshot.projectId &&
    baseline.storyId === snapshot.storyId &&
    baseline.viewportName === snapshot.viewportName &&
    (baseline.browser ?? DEFAULT_BROWSER) === (snapshot.browser ?? DEFAULT_BROWSER) &&
    baseline.screenshotPath === snapshot.screenshotPath
  );
}

async function verifiedBuild(
  buildId: string,
  projectId: string,
  reader: BaselineOriginReader,
): Promise<Build | null> {
  const build = await reader.build(buildId);
  return build?.projectId === projectId ? build : null;
}
