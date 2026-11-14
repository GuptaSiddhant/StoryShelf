/** Handlers of the snapshot review endpoints (composed by `snapshots.ts`). */
import { REDIFFABLE_BUILD_STATUSES, rediffBuild } from "@storyshelf/core/capture";
import { SnapshotModel } from "@storyshelf/core/models";
import type { Build, Project } from "@storyshelf/core/schema";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { getStore } from "../store.ts";
import { findDriftedSnapshots, isBaselineChanged, isOpenSnapshot } from "./baseline-guard.ts";
import {
  APPROVER_ROLES,
  approveSnapshot,
  buildForProject,
  refreshBuild,
  snapshotForBuild,
} from "./builds.handlers.ts";
import { flashHx } from "./flash.ts";
import { resolveAuthorizedProject } from "./helpers.ts";
import { hxRefresh, isHxRequest } from "./htmx.ts";
import { hxAdvance } from "./review-next.ts";
import { approveGroup, rejectGroup, splitByDrift } from "./snapshot-groups.ts";

interface BuildParams {
  slug: string;
  buildId: string;
}

interface SnapshotParams extends BuildParams {
  snapshotId: string;
}

interface GroupParams extends BuildParams {
  storyId: string;
  modeKey: string;
}

/** The user a review is attributed to: the session user, if any. */
function reviewer(): string | null {
  return getStore().user?.id ?? null;
}

async function authorizeApprover(
  c: Context,
  { slug, buildId }: BuildParams,
): Promise<{ project: Project; build: Build }> {
  const project = await resolveAuthorizedProject(c, slug, ...APPROVER_ROLES);
  return { project, build: await buildForProject(project.id, buildId) };
}

/**
 * Answer an approval that failed because the baseline changed: from the review page, send the
 * browser to `location` (it recomputes staleness on load and offers re-diff / approve anyway).
 * Any other failure, or a non-HTMX caller, is rethrown.
 */
function redirectOnDrift(c: Context, error: unknown, location: string): void {
  if (!isHxRequest(c) || !isBaselineChanged(error)) {
    throw error;
  }
  c.header("HX-Redirect", location);
}

/**
 * What a group decision answers: the snapshots it decided, and the review page swapped in place
 * when HTMX asked from it (null otherwise: the route answers JSON).
 */
export interface GroupDecision {
  snapshotIds: string[];
  swap: Response | null;
}

async function advanceToFirst(
  c: Context,
  decided: { project: Project; build: Build },
  snapshotIds: string[],
): Promise<GroupDecision> {
  const first = snapshotIds[0];
  const swap = first ? await hxAdvance(c, { ...decided, snapshotId: first }) : null;
  return { snapshotIds, swap };
}

/**
 * Approve one snapshot. HTMX on the review page gets the next snapshot swapped in (a Response);
 * on a changed baseline it is redirected to the diff page instead. Otherwise null.
 */
export async function approveOne(
  c: Context,
  p: SnapshotParams,
  force: boolean,
): Promise<Response | null> {
  const { project, build } = await authorizeApprover(c, p);
  await snapshotForBuild(build, p.snapshotId);
  try {
    await approveSnapshot(p.snapshotId, reviewer(), { force });
  } catch (error) {
    redirectOnDrift(
      c,
      error,
      `/projects/${p.slug}/builds/${p.buildId}/diff?snapshot=${p.snapshotId}`,
    );
    return null;
  }
  return await hxAdvance(c, { project, build, snapshotId: p.snapshotId });
}

/** Reject one snapshot; HTMX on the review page gets the next snapshot swapped in, else null. */
export async function rejectOne(c: Context, p: SnapshotParams): Promise<Response | null> {
  const { project, build } = await authorizeApprover(c, p);
  const snapshot = await snapshotForBuild(build, p.snapshotId);
  await new SnapshotModel(getStore().db).review(snapshot.id, "rejected", reviewer());
  await refreshBuild(build.id);
  return await hxAdvance(c, { project, build, snapshotId: p.snapshotId });
}

/** Approve every open snapshot; returns the ids skipped because their baseline drifted. */
export async function approveAll(c: Context, p: BuildParams, force: boolean): Promise<string[]> {
  const { project, build } = await authorizeApprover(c, p);
  const snapshots = await new SnapshotModel(getStore().db).listByBuild(build.id);
  const drifted = force ? new Map() : await findDriftedSnapshots(project, build, snapshots);
  // A story/mode is approved on every engine or on none: one drifted member skips its group.
  const { approvable, skipped } = splitByDrift(
    snapshots.filter((snapshot) => isOpenSnapshot(snapshot)),
    drifted,
  );
  const userId = reviewer();
  await Promise.all(
    approvable.map(async (snapshot) => {
      await approveSnapshot(snapshot.id, userId, { force, deferRefresh: true });
    }),
  );
  await refreshBuild(build.id);
  hxRefresh(c);
  return skipped.map((snapshot) => snapshot.id);
}

/** Approve a story/mode across browsers: the approved ids (none on a UI-handled drift). */
export async function approveGroupOf(
  c: Context,
  p: GroupParams,
  force: boolean,
): Promise<GroupDecision> {
  const { project, build } = await authorizeApprover(c, p);
  let snapshotIds: string[];
  try {
    snapshotIds = await approveGroup(project, build, p, reviewer(), { force });
  } catch (error) {
    redirectOnDrift(c, error, `/projects/${p.slug}/builds/${p.buildId}/diff`);
    return { snapshotIds: [], swap: null };
  }
  return await advanceToFirst(c, { project, build }, snapshotIds);
}

/** Reject a story/mode across browsers: the rejected ids. */
export async function rejectGroupOf(c: Context, p: GroupParams): Promise<GroupDecision> {
  const { project, build } = await authorizeApprover(c, p);
  const snapshotIds = await rejectGroup(build, p, reviewer());
  return await advanceToFirst(c, { project, build }, snapshotIds);
}

function assertRediffable(build: Build): void {
  if (build.isDefault) {
    throw new HTTPException(400, { message: "Default-branch builds are not re-diffed" });
  }
  if (!REDIFFABLE_BUILD_STATUSES.has(build.status)) {
    throw new HTTPException(409, {
      message: `Build is ${build.status}; wait for capture to finish or retry capture`,
    });
  }
}

/** Re-diff the undecided snapshots against the current baselines (no re-render). */
export async function rediffOne(
  c: Context,
  p: BuildParams,
): Promise<Awaited<ReturnType<typeof rediffBuild>>> {
  const { project, build } = await authorizeApprover(c, p);
  assertRediffable(build);
  const { db, storage, logger } = getStore();
  const result = await rediffBuild({ db, storage, logger }, project, build);
  await refreshBuild(build.id);
  hxRefresh(c);
  flashHx(c, "Re-diffed against current baselines");
  return result;
}

/** Reject every new or changed snapshot of a build. */
export async function rejectAll(c: Context, p: BuildParams): Promise<void> {
  const { build } = await authorizeApprover(c, p);
  const model = new SnapshotModel(getStore().db);
  const snapshots = await model.listByBuild(build.id);
  const userId = reviewer();
  await Promise.all(
    snapshots
      .filter((snapshot) => snapshot.status === "new" || snapshot.status === "changed")
      .map(async (snapshot) => {
        await model.review(snapshot.id, "rejected", userId);
      }),
  );
  await refreshBuild(build.id);
  hxRefresh(c);
}
