/** Shared types for the Playwright capture runner. */

import type {
  BrowserName,
  StoryEntry,
  StorySourceAdapter,
  Viewport,
} from "@storyshelf/core/adapter/capture-runner";
import type { StoryParameters } from "@storyshelf/core/capture";
import type { Logger } from "@storyshelf/core/logger";
import type { Browser } from "playwright-core";

/** Input for a Playwright capture run over a built Storybook directory. */
export interface PlaywrightRenderInput {
  buildId: string;
  storybookDir: string;
  stories: StoryEntry[];
  viewports: Viewport[];
  logger?: Logger;
  executePlay?: boolean;
  playTimeoutMs?: number;
  runA11y?: boolean;
  browser?: BrowserName;
  /** Max pages rendering at once (default: sized from detected CPU and memory). */
  concurrency?: number;
  /** Per-page navigation/action timeout in ms (default: scaled up on CPU-starved hosts). */
  navigationTimeoutMs?: number;
  /** Restart the browser after this many captures to bound its slow growth (0 disables; default 150). */
  recycleBrowserEvery?: number;
  /** Test/extension seam: story source adapter (defaults to `StorybookAdapter`). */
  adapter?: StorySourceAdapter;
}

/** Input for the parameter pre-pass (a subset of the render input). */
export type ExtractInput = Pick<
  PlaywrightRenderInput,
  "buildId" | "storybookDir" | "stories" | "logger" | "browser" | "adapter"
>;

/** Browser + adapter context shared by screenshot helpers. */
export interface ScreenshotContext {
  browser: Browser;
  adapter: StorySourceAdapter;
  baseUrl: string;
}

/** Extended context threaded through the capture pipeline. */
export interface CaptureContext extends ScreenshotContext {
  navigationTimeoutMs?: number;
  executePlay?: boolean;
  playTimeoutMs?: number;
  runA11y?: boolean;
  runtimeParams: RuntimeParamsState;
}

/** Per-run cache of story parameters read from the running preview. */
export interface RuntimeParamsState {
  extractFailed?: boolean;
  extractPromise?: Promise<Map<string, StoryParameters>>;
}

/** A page handle able to run the extraction script. */
export type RuntimeParamsPage = {
  evaluate: (pageFunction: unknown, ...args: unknown[]) => Promise<unknown>;
};

/** Raw entry returned by `__STORYBOOK_PREVIEW__.extract()`. */
export interface ExtractedEntry {
  parameters?: { chromatic?: StoryParameters; storyshelf?: StoryParameters };
}

/** A render that may currently be in flight, so that `cancel` can abort it. */
export interface ActiveRun {
  cancelled: boolean;
  browser: Browser | null;
}
