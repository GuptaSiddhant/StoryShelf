import { BuildModel } from "@storyshelf/core/models";
import type { Build } from "@storyshelf/core/schema";
import { catalogOf, getStore } from "../store.ts";

/** What a skipped build repeats: the real build behind it, as it is now (ADR 0044). */
export interface SkipSource {
  /** The source build, or null once it was deleted. */
  build: Build | null;
  /** Whether the source's Storybook is still published. */
  storybook: boolean;
}

/** Resolve the source of one skipped build, with its current status and Storybook availability. */
export async function loadSkipSource(build: Build): Promise<SkipSource> {
  const source = await new BuildModel(getStore().db).skipSourceOf(build);
  if (!source) {
    return { build: null, storybook: false };
  }
  const catalog = await catalogOf()
    .load(source.projectId, source.id)
    .catch(() => null);
  return { build: source, storybook: catalog !== null };
}

/** Resolve the sources of every skipped build in `builds`, keyed by the skipped build's id. */
export async function loadSkipSources(builds: Build[]): Promise<Map<string, SkipSource>> {
  const skipped = builds.filter((build) => build.status === "skipped");
  const entries = await Promise.all(
    skipped.map(async (build) => [build.id, await loadSkipSource(build)] as const),
  );
  return new Map(entries);
}

/** The commit a skipped build was compared with: its source's, else the one it recorded. */
export function skipSourceSha(build: Build, source: SkipSource | undefined): string {
  return (source?.build?.gitSha ?? build.baselineSha ?? "").slice(0, 7);
}

/** "No story changed since a1b2c3d", the one sentence for a skipped build's outcome. */
export function noStoryChangedText(sha: string): string {
  return sha ? `No story changed since ${sha}` : "No story changed";
}
