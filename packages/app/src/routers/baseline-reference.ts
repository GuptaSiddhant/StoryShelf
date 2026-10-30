import {
  BaselineModel,
  BuildModel,
  SnapshotModel,
  baselineStatus,
  resolveBaselineOrigin,
} from "@storyshelf/core/models";
import type { Baseline, Build, Project, Snapshot } from "@storyshelf/core/schema";
import { getStore } from "../store.ts";
import { readComparisonImage, validFrozenReference } from "./comparison-image.ts";

/** Reference information is only reliable while the recorded baseline version still exists. */
export type BaselineReference =
  | { kind: "none" }
  | { kind: "unavailable" }
  | {
      kind: "known";
      branch: string;
      defaultBranch: boolean;
      updatedAt: string;
      build: Build | null;
      imageAvailable: boolean;
    };

export async function loadBaselineReference(
  project: Project,
  build: Build,
  snapshot: Snapshot,
): Promise<BaselineReference> {
  if (snapshot.comparisonImagePath || snapshot.comparisonMetadata) {
    return await frozenReference(project, build, snapshot);
  }
  return await legacyReference(project, build, snapshot);
}

async function legacyReference(
  project: Project,
  build: Build,
  snapshot: Snapshot,
): Promise<BaselineReference> {
  if (snapshot.baselineVersion === "none" && snapshot.baselineId === null) return { kind: "none" };
  if (!snapshot.baselineId || !snapshot.baselineVersion) return { kind: "unavailable" };
  const db = getStore().db;
  const baseline = await new BaselineModel(db).resolve(
    project.id,
    snapshot.storyId,
    snapshot.viewportName,
    build.gitBranch,
    project.gitDefaultBranch,
    snapshot.browser,
  );
  if (!baseline || baselineStatus(snapshot, baseline) !== "current") return { kind: "unavailable" };
  const snapshots = new SnapshotModel(db);
  const builds = new BuildModel(db);
  const reference = await resolveBaselineOrigin(baseline, {
    baseline: async (id) => (await db.get(db.tables.baselines, id)) as unknown as Baseline | null,
    snapshot: async (id) => await snapshots.get(id),
    build: async (id) => await builds.get(id),
  });
  return {
    kind: "known",
    branch: baseline.branch,
    defaultBranch: baseline.branch === project.gitDefaultBranch,
    updatedAt: baseline.updatedAt,
    imageAvailable: await imageExists(baseline.screenshotPath),
    build: reference,
  };
}

async function frozenReference(
  project: Project,
  build: Build,
  snapshot: Snapshot,
): Promise<BaselineReference> {
  const frozen = validFrozenReference(snapshot, project.id, build.id);
  if (!frozen) return { kind: "unavailable" };
  const { reference: metadata, path } = frozen;
  const reference = metadata.sourceBuildId
    ? await new BuildModel(getStore().db).get(metadata.sourceBuildId)
    : null;
  return {
    kind: "known",
    branch: metadata.branch,
    defaultBranch: metadata.defaultBranch,
    updatedAt: metadata.baselineVersion,
    imageAvailable: Boolean(await readComparisonImage(path, metadata.imageSha256)),
    build: reference?.projectId === project.id ? reference : null,
  };
}

export interface DefaultComparison {
  id: string;
  version: string;
  branch: string;
  available: boolean;
  environment: "unknown" | "matching" | "different";
}

/** A separate, read-only view of the current default-branch reference. */
export async function loadDefaultComparison(
  project: Project,
  build: Build,
  snapshot: Snapshot,
): Promise<DefaultComparison | null> {
  if (build.gitBranch === project.gitDefaultBranch) return null;
  const { db } = getStore();
  const baseline = await new BaselineModel(db).getFor(
    project.id,
    snapshot.storyId,
    snapshot.viewportName,
    project.gitDefaultBranch,
    snapshot.browser,
  );
  if (
    !baseline ||
    (baseline.id === snapshot.baselineId && baseline.updatedAt === snapshot.baselineVersion)
  )
    return null;
  const environment =
    !baseline.infraHash || !snapshot.infraHash
      ? "unknown"
      : baseline.infraHash === snapshot.infraHash
        ? "matching"
        : "different";
  return {
    id: baseline.id,
    version: baseline.updatedAt,
    branch: baseline.branch,
    available: await imageExists(baseline.screenshotPath),
    environment,
  };
}

async function imageExists(path: string): Promise<boolean> {
  try {
    return await getStore().storage.exists(path);
  } catch {
    return false;
  }
}
