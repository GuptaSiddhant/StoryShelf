/** Decision 5 of ADR 0052: only an unchanged result is taken from a switched capture. */
import type { RenderedSnapshot, SwitchStoriesRequest } from "../adapters/capture-runner.ts";
import type { BaselineMap } from "../models/baseline-map.ts";
import type { StoryEntry, Viewport } from "./adapter.ts";
import { resolveStoryViewports } from "./storybook.ts";

/**
 * The story/viewport pairs of `stories` that have a baseline on `browser`: the only ones a runner
 * may switch to, since only they can be confirmed (decision 5).
 */
export function switchRequestOf(
  stories: readonly StoryEntry[],
  viewports: readonly Viewport[],
  baselines: BaselineMap,
  browser: string,
): SwitchStoriesRequest {
  return {
    baselined: stories.flatMap((story) =>
      resolveStoryViewports(story, [...viewports])
        .filter((viewport) => baselines.get(story.id, viewport.name, browser) !== null)
        .map((viewport) => ({ storyId: story.id, viewportName: viewport.name })),
    ),
  };
}

/**
 * The stories with a switched capture that is not byte-identical to its baseline. Screenshots
 * are stored by content hash, so the same path means the same bytes: a switched capture is kept
 * only when its path is the baseline's. Every other one is discarded and its story rendered again
 * on a fresh page, so no change, no new baseline and no picture a reviewer sees comes from a
 * switched page.
 */
export function unconfirmedStories(
  captures: readonly RenderedSnapshot[],
  baselines: BaselineMap,
  browser: string,
): Set<string> {
  const out = new Set<string>();
  for (const capture of captures) {
    if (capture.switched !== true) continue;
    const baseline = baselines.get(capture.story.id, capture.viewportName, browser);
    if (baseline === null || capture.storedPath !== baseline.screenshotPath) {
      out.add(capture.story.id);
    }
  }
  return out;
}

/** What a switched pass left once its unconfirmed stories were rendered again on fresh pages. */
export function replaceStories<T extends { story?: StoryEntry; storyId?: string }>(
  first: readonly T[],
  again: readonly T[],
  stories: ReadonlySet<string>,
): T[] {
  const idOf = (row: T): string | undefined => row.story?.id ?? row.storyId;
  return [...first.filter((row) => !stories.has(idOf(row) ?? "")), ...again];
}
