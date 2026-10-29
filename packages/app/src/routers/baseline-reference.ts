import { BaselineModel, BuildModel, SnapshotModel, baselineStatus } from "@storyshelf/core/models";
import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import { getStore } from "../store.ts";

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
    };

export async function loadBaselineReference(
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
  const source = baseline.snapshotId ? await new SnapshotModel(db).get(baseline.snapshotId) : null;
  // An inherited snapshot did not produce the image, and its actual origin is not recorded.
  const reference =
    source && !source.inherited && source.projectId === project.id
      ? await new BuildModel(db).get(source.buildId)
      : null;
  return {
    kind: "known",
    branch: baseline.branch,
    defaultBranch: baseline.branch === project.gitDefaultBranch,
    updatedAt: baseline.updatedAt,
    build: reference?.projectId === project.id ? reference : null,
  };
}
