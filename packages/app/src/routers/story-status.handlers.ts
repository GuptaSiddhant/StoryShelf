import { contentHostSuffix } from "@storyshelf/core/config";
import { normalizeImportPath, SnapshotModel, worstStatus } from "@storyshelf/core/models";
import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import type { SnapshotStatus } from "@storyshelf/core/types";
import { createUrlBuilder } from "@storyshelf/core/urls";
import { getStore } from "../store.ts";
import { driftByFile } from "./design-coverage.handlers.ts";

/** One story's badge state. */
export interface StoryStatusEntry {
  status: SnapshotStatus;
  /** Present only for a known design problem; `current` and `unknown` are left out. */
  design?: "stale" | "deleted";
}

/** What the Storybook addon reads (ADR 0042, decision 3). */
export interface StoryStatusBody {
  build: { status: Build["status"]; reviewPath: string };
  stories: Record<string, StoryStatusEntry>;
}

/** The build's review page as a path and query only: the addon resolves it against its own origin. */
function reviewPathOf(slug: string, buildId: string): string {
  const url = createUrlBuilder("/", contentHostSuffix(getStore().config)).buildDiff(slug, buildId);
  const parsed = new URL(url, "http://relative.invalid");
  return `${parsed.pathname}${parsed.search}`;
}

/** The worst snapshot status per story, with a design problem where one is known. */
export async function storyStatusOf(project: Project, build: Build): Promise<StoryStatusBody> {
  const snapshots = await new SnapshotModel(getStore().db).listByBuild(build.id);
  const drift = await driftByFile(project, snapshots);
  const stories: Record<string, StoryStatusEntry> = {};
  for (const [storyId, own] of Map.groupBy(snapshots, (snap) => snap.storyId)) {
    stories[storyId] = entryOf(own, drift);
  }
  return {
    build: { status: build.status, reviewPath: reviewPathOf(project.slug, build.id) },
    stories,
  };
}

function entryOf(own: readonly Snapshot[], drift: ReadonlyMap<string, string>): StoryStatusEntry {
  const status = worstStatus(own.map((snap) => snap.status));
  const file = own[0]?.storyImportPath;
  const problem = file ? drift.get(normalizeImportPath(file)) : undefined;
  return problem === "stale" || problem === "deleted" ? { status, design: problem } : { status };
}
