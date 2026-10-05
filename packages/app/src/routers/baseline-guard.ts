/** Refuse to promote a screenshot over a baseline the reviewer has not seen. */
import {
  BaselineModel,
  baselineStatus,
  isBaselineDrifted,
  type BaselineStatus,
} from "@storyshelf/core/models";
import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import { HTTPException } from "hono/http-exception";
import { getStore } from "../store.ts";

/** Whether a snapshot is awaiting a review decision. */
export function isOpenSnapshot(snapshot: Pick<Snapshot, "status">): boolean {
  return snapshot.status === "new" || snapshot.status === "changed";
}

/** Compare a snapshot's recorded baseline with the baseline that applies to it now. */
export async function snapshotBaselineStatus(
  project: Pick<Project, "id" | "gitDefaultBranch">,
  build: Pick<Build, "gitBranch">,
  snapshot: Snapshot,
): Promise<BaselineStatus> {
  const baselines = new BaselineModel(getStore().db);
  const current = await baselines.resolve(
    project.id,
    snapshot.storyId,
    snapshot.viewportName,
    build.gitBranch,
    project.gitDefaultBranch,
  );
  return baselineStatus(snapshot, current);
}

/** Open snapshots whose diff no longer matches the current baseline. */
export async function findDriftedSnapshots(
  project: Pick<Project, "id" | "gitDefaultBranch">,
  build: Pick<Build, "gitBranch">,
  snapshots: Snapshot[],
): Promise<Map<string, BaselineStatus>> {
  const open = snapshots.filter((snapshot) => isOpenSnapshot(snapshot));
  const statuses = await Promise.all(
    open.map(async (snapshot) => await snapshotBaselineStatus(project, build, snapshot)),
  );
  const drifted = new Map<string, BaselineStatus>();
  for (const [index, snapshot] of open.entries()) {
    const status = statuses[index];
    if (status && isBaselineDrifted(status)) {
      drifted.set(snapshot.id, status);
    }
  }
  return drifted;
}

/** 409 telling the client the diff is out of date; recompute it or force the approval. */
export function baselineChanged(snapshotId: string, status: BaselineStatus): HTTPException {
  const body = {
    code: "baseline_changed",
    message:
      "The baseline changed after this diff was computed. Re-diff the build, or approve with force.",
    snapshotId,
    baselineStatus: status,
  };
  return new HTTPException(409, {
    res: new Response(JSON.stringify(body), {
      status: 409,
      headers: { "content-type": "application/json" },
    }),
  });
}

/** Throw {@link baselineChanged} when an open snapshot's baseline drifted and `force` is off. */
export async function assertBaselineCurrent(
  project: Pick<Project, "id" | "gitDefaultBranch">,
  build: Pick<Build, "gitBranch">,
  snapshot: Snapshot,
  force: boolean,
): Promise<void> {
  if (!isOpenSnapshot(snapshot)) {
    return;
  }
  const status = await snapshotBaselineStatus(project, build, snapshot);
  if (!isBaselineDrifted(status)) {
    return;
  }
  if (force) {
    getStore().logger.warn(
      { snapshotId: snapshot.id, baselineStatus: status, userId: getStore().user?.id ?? null },
      "approved snapshot despite changed baseline (forced)",
    );
    return;
  }
  throw baselineChanged(snapshot.id, status);
}

/** True when `error` is the 409 raised by {@link baselineChanged}. */
export function isBaselineChanged(error: unknown): boolean {
  return error instanceof HTTPException && error.status === 409;
}

/** Per-snapshot baseline facts the review pages need. */
export interface BaselineView {
  /** Snapshot ids that have a baseline to compare against. */
  hasBaseline: Record<string, boolean>;
  /** Open snapshots whose recorded baseline no longer matches the current one. */
  drifted: Record<string, "stale" | "removed">;
}

/** Resolve each snapshot's current baseline once and derive presence plus drift. */
export async function loadBaselineView(
  project: Pick<Project, "id" | "gitDefaultBranch">,
  build: Pick<Build, "gitBranch" | "isDefault">,
  snapshots: Snapshot[],
): Promise<BaselineView> {
  const baselines = new BaselineModel(getStore().db);
  const entries = await Promise.all(
    snapshots.map(async (snapshot) => {
      const current = await baselines.resolve(
        project.id,
        snapshot.storyId,
        snapshot.viewportName,
        build.gitBranch,
        project.gitDefaultBranch,
      );
      return { snapshot, current };
    }),
  );
  const view: BaselineView = { hasBaseline: {}, drifted: {} };
  for (const { snapshot, current } of entries) {
    view.hasBaseline[snapshot.id] = Boolean(current);
    const status = baselineStatus(snapshot, current);
    if (
      !build.isDefault &&
      isOpenSnapshot(snapshot) &&
      (status === "stale" || status === "removed")
    ) {
      view.drifted[snapshot.id] = status;
    }
  }
  return view;
}
