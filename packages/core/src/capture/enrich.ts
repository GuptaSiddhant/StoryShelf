/** Orchestrator pre-pass: learn each story's modes before building the capture matrix. */
import type { Logger } from "pino";
import type { CaptureTarget, CaptureRunner } from "../adapters/capture-runner.ts";
import type { StoryEntry, Viewport } from "./adapter.ts";
import { filterModes, MAX_MODES_PER_STORY } from "./modes.ts";
import { resolveStoryViewports } from "./storybook.ts";

/** Inputs for {@link enrichStories}. */
export interface EnrichInput {
  runner: CaptureRunner;
  buildId: string;
  storybookDir: string;
  stories: StoryEntry[];
  target: CaptureTarget;
  allowlist: readonly string[] | null;
  logger: Logger | undefined;
}

/**
 * Merge runtime-resolved parameters (project/component/story levels stacked by
 * Storybook) over the index's, then apply the project's mode allowlist. A
 * runner without `extractParameters`, or one that fails, leaves index
 * parameters untouched — the build still captures plain viewports.
 */
export async function enrichStories(input: EnrichInput): Promise<StoryEntry[]> {
  const extracted = await extractSafely(input);
  return input.stories.map((story) => {
    const parameters = { ...story.parameters, ...extracted[story.id] };
    const modes = filterModes(parameters.modes, input.allowlist);
    if (modes) parameters.modes = modes;
    return Object.keys(parameters).length > 0 ? { ...story, parameters } : story;
  });
}

/**
 * Fail the build before any rendering when a story expands beyond the cap
 * (global viewports + default viewport + modes).
 */
export function assertModeCaps(stories: StoryEntry[], viewports: Viewport[]): void {
  for (const story of stories) {
    const count = resolveStoryViewports(story, viewports).length;
    if (count > MAX_MODES_PER_STORY) {
      throw new Error(
        `Story "${story.id}" expands to ${count} captures (max ${MAX_MODES_PER_STORY}); reduce its modes or the project viewports`,
      );
    }
  }
}

async function extractSafely(
  input: EnrichInput,
): ReturnType<NonNullable<CaptureRunner["extractParameters"]>> {
  const { runner } = input;
  if (!runner.extractParameters) return {};
  try {
    return await runner.extractParameters({
      buildId: input.buildId,
      storybookDir: input.storybookDir,
      stories: input.stories,
      target: input.target,
      ...(input.logger ? { logger: input.logger } : {}),
    });
  } catch (error) {
    input.logger?.warn({ err: error }, "parameter extraction failed; modes from index only");
    return {};
  }
}
