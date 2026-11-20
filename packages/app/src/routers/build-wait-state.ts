/**
 * What `storyshelf upload --wait` reads from `GET …/builds/:buildId` besides the build row: how
 * publishing stands and how far capture has got. Both are optional additions to the response
 * (ADR 0053, an expand step); an older CLI ignores them.
 */
import { publishingOfBuild } from "@storyshelf/core/capture";
import { SnapshotModel } from "@storyshelf/core/models";
import type { Build } from "@storyshelf/core/schema";
import { catalogOf, getStore } from "../store.ts";

/** Stories with a stored snapshot (rendered or inherited) out of the stories the build holds. */
export interface CaptureProgress {
  done: number;
  /** Story entries of the build's catalog; null when the catalog cannot be read. */
  total: number | null;
}

/** The extra fields of the build-detail answer. */
export interface BuildWaitState {
  publishing: Awaited<ReturnType<typeof publishingOfBuild>>;
  /** Null for a build that captures nothing: testing is off, or the build is skipped. */
  capture: CaptureProgress | null;
}

/** Publishing state and capture progress of a build, from its row and two small reads. */
export async function buildWaitState(build: Build): Promise<BuildWaitState> {
  const store = getStore();
  const publishing = await publishingOfBuild({ db: store.db, storage: store.storage }, build);
  if (!store.testing || build.status === "skipped") {
    return { publishing, capture: null };
  }
  return { publishing, capture: await captureProgress(build) };
}

/** Distinct stories with a snapshot (rendered or inherited) over the catalog's story count. */
async function captureProgress(build: Build): Promise<CaptureProgress> {
  const rows = await new SnapshotModel(getStore().db).listByBuildSummary(build.id);
  return { done: new Set(rows.map((row) => row.storyId)).size, total: await totalStories(build) };
}

/** Story entries of the build's catalog; null when the catalog cannot be read. */
async function totalStories(build: Build): Promise<number | null> {
  try {
    const catalog = await catalogOf().load(build.projectId, build.id);
    return catalog === null ? null : catalog.entries.filter((e) => e.type === "story").length;
  } catch {
    return null;
  }
}
