/** Handing a capture over: the snapshot row, its accessibility lines, or the story's failure. */

import type {
  RenderResult,
  RenderedSnapshot,
  StoryEntry,
  Viewport,
} from "@storyshelf/core/adapter/capture-runner";
import { messageOf } from "./browser.ts";
import type { CaptureResult } from "./screenshot.ts";
import type { PlaywrightRenderInput } from "./types.ts";

/** Where a run's captures and failures go. */
export interface Delivery {
  captures: RenderedSnapshot[];
  failures: RenderResult["failures"];
}

/**
 * Stream the capture to `onCapture` (or keep it), then report its accessibility lines. `switched`
 * marks a capture taken after switching stories inside a loaded page (ADR 0052).
 */
export async function deliverCapture(
  input: PlaywrightRenderInput,
  out: Delivery,
  viewport: Viewport,
  result: CaptureResult & { startedAt: number; switched?: boolean },
): Promise<void> {
  const snapshot: RenderedSnapshot = {
    story: result.story,
    viewportName: viewport.name,
    viewport,
    screenshot: result.screenshot,
    durationMs: Math.round(performance.now() - result.startedAt),
    ...(result.a11yViolations.length > 0 ? { a11y: result.a11yViolations } : {}),
    ...(result.switched ? { switched: true } : {}),
  };
  // Streaming: hand it over and drop the buffer rather than holding every screenshot.
  if (input.onCapture) await input.onCapture(snapshot);
  else out.captures.push(snapshot);
  if (result.a11yViolations.length > 0)
    reportA11y(input, out.failures, result.story, viewport, result.a11yViolations);
}

function reportA11y(
  input: PlaywrightRenderInput,
  failures: RenderResult["failures"],
  story: StoryEntry,
  viewport: Viewport,
  violations: string[],
): void {
  failures.push({
    storyId: story.id,
    viewportName: viewport.name,
    error: `a11y: ${violations.join("; ")}`,
  });
  input.logger?.warn(
    { storyId: story.id, viewport: viewport.name, violations },
    "a11y violations found",
  );
}

/** Record a story/viewport the run could not capture. */
export function pushRenderFailure(
  failures: RenderResult["failures"],
  input: PlaywrightRenderInput,
  storyId: string,
  viewportName: string,
  error: unknown,
): void {
  failures.push({ storyId, viewportName, error: messageOf(error) });
  input.logger?.error({ storyId, viewport: viewportName, err: error }, "render failed for story");
}
