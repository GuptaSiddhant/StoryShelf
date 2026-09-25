import { normalizePath } from "./stats.ts";
import type { StoryLike } from "./types.ts";

/** Stories split into render-now versus inherit-from-baseline sets. */
export interface StoryPartition<T> {
  /** Stories to capture in this build. */
  render: T[];
  /** Stories to inherit unchanged from their baseline. */
  inherit: T[];
}

/** Sort stories into render versus inherit buckets for an affected set. */
function partitionByPath<T extends StoryLike>(
  stories: readonly T[],
  affected: ReadonlySet<string>,
  render: T[],
  inherit: T[],
): void {
  for (const story of stories) {
    const path = storyPath(story);
    if (path === null || affected.has(path)) {
      render.push(story);
    } else {
      inherit.push(story);
    }
  }
}

/** Import path of a story record, normalized for affected comparison. */
function storyPath(story: StoryLike): string | null {
  if (typeof story.importPath !== "string" || story.importPath.length === 0) {
    return null;
  }
  return normalizePath(story.importPath);
}

/**
 * Partition stories into render versus inherit sets.
 *
 * Stories without an import path always render (they cannot be matched).
 * A `null` affected set renders everything (full capture).
 *
 * @param stories - Discovered stories for the build.
 * @param affectedImportPaths - Affected import paths, or `null` for full.
 */
export function selectAffectedStories<T extends StoryLike>(
  stories: readonly T[],
  affectedImportPaths: readonly string[] | null,
): StoryPartition<T> {
  const render: T[] = [];
  const inherit: T[] = [];
  if (affectedImportPaths === null) {
    return { render: [...stories], inherit };
  }
  partitionByPath(
    stories,
    new Set(affectedImportPaths.map((path) => normalizePath(path))),
    render,
    inherit,
  );
  return { render, inherit };
}
