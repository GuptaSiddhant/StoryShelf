/** Sorting a render's failures into the three kinds that decide a build's status. */
import type { RenderFailure } from "../adapters/capture-runner.ts";
import { isFlakyStory, type StoryEntry } from "./adapter.ts";

/** Story ids by how their failure counts. */
export interface FailureSets {
  /** Fail the build. */
  blocking: Set<string>;
  /** Flaky stories: logged, never blocking. */
  flaky: Set<string>;
  /** Accessibility violations: logged, never blocking. */
  a11y: Set<string>;
}

/** Classify render failures: `a11y:` errors, then flaky stories, then everything else is blocking. */
export function classifyFailures(
  stories: readonly StoryEntry[],
  failures: readonly RenderFailure[],
): FailureSets {
  const flakyIds = new Set(stories.filter((story) => isFlakyStory(story)).map((story) => story.id));
  const sets: FailureSets = { blocking: new Set(), flaky: new Set(), a11y: new Set() };
  for (const failure of failures) {
    if (failure.error.startsWith("a11y:")) {
      sets.a11y.add(failure.storyId);
    } else if (flakyIds.has(failure.storyId)) {
      sets.flaky.add(failure.storyId);
    } else {
      sets.blocking.add(failure.storyId);
    }
  }
  return sets;
}
