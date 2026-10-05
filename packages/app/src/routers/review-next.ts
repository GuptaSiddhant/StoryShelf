import { SnapshotModel } from "@storyshelf/core/models";
import type { Snapshot } from "@storyshelf/core/schema";
import type { Context } from "hono";
import { getStore } from "../store.ts";
import { isOpenSnapshot } from "./baseline-guard.ts";
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

/**
 * After a single-snapshot decision, send HTMX clients to the next open
 * snapshot (so a reviewer can clear a build with `a`/`r`), or reload the
 * current page when nothing is left.
 */
export async function hxAdvance(
  c: Context,
  target: { slug: string; buildId: string; snapshotId: string },
): Promise<void> {
  if (!isHxRequest(c)) {
    return;
  }
  const snapshots = await new SnapshotModel(getStore().db).listByBuild(target.buildId);
  const next = nextOpenSnapshotId(snapshots, target.snapshotId);
  if (next === null) {
    hxRefresh(c);
    return;
  }
  c.header(
    "HX-Redirect",
    `/projects/${target.slug}/builds/${target.buildId}/diff?snapshot=${next}`,
  );
}
