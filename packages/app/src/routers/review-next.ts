import { SnapshotModel } from "@storyshelf/core/models";
import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import type { Context } from "hono";
import { snapshotPageUrl } from "../pages/build-diff-model.ts";
import { renderReviewSwap } from "../pages/build-diff-swap.tsx";
import { getStore } from "../store.ts";
import { isOpenSnapshot } from "./baseline-guard.ts";
import { loadBuildDiffData } from "./build-diff-data.ts";
import { hxRefresh, isHxRequest } from "./htmx.ts";

/**
 * The next snapshot still waiting for a decision after `currentId`, in list
 * order, wrapping to the start. Null when nothing else is open.
 */
export function nextOpenSnapshotId(snapshots: Snapshot[], currentId: string): string | null {
  const index = snapshots.findIndex((snap) => snap.id === currentId);
  const ordered = [...snapshots.slice(index + 1), ...snapshots.slice(0, Math.max(index, 0))];
  return ordered.find((snap) => snap.id !== currentId && isOpenSnapshot(snap))?.id ?? null;
}

/** Whether HTMX issued the request from a build's review page (`.../diff`). */
function fromReviewPage(c: Context): boolean {
  try {
    return new URL(c.req.header("HX-Current-URL") ?? "").pathname.endsWith("/diff");
  } catch {
    return false;
  }
}

/** The build a decision was made on, and the snapshot it was made on. */
export interface AdvanceTarget {
  project: Project;
  build: Build;
  snapshotId: string;
}

/**
 * The review page, swapped in place on the next open snapshot (or, with nothing left open, the
 * one just decided, which then shows the build's done state). `HX-Push-Url` keeps the address
 * bar on `?snapshot=`, so reload and back land where the reviewer is.
 */
async function reviewSwap(c: Context, target: AdvanceTarget): Promise<Response> {
  const { project, build } = target;
  const snapshots = await new SnapshotModel(getStore().db).listByBuildSummary(build.id);
  const shown = nextOpenSnapshotId(snapshots, target.snapshotId) ?? target.snapshotId;
  const url = snapshotPageUrl(project, build, shown);
  const data = await loadBuildDiffData(c, project, build, { snapshotId: shown, returnPath: url });
  c.header("HX-Push-Url", url);
  return c.html(renderReviewSwap(data));
}

/**
 * After a single-snapshot decision, answer HTMX on the review page with the next open snapshot,
 * swapped in place (so a reviewer can clear a build with `a`/`r` without a page load). Elsewhere
 * HTMX reloads the current page, and a plain request gets null: the caller answers it.
 */
export async function hxAdvance(c: Context, target: AdvanceTarget): Promise<Response | null> {
  if (!isHxRequest(c)) {
    return null;
  }
  if (!fromReviewPage(c)) {
    hxRefresh(c);
    return null;
  }
  return await reviewSwap(c, target);
}
