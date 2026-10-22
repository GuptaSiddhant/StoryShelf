/** Shared types for the Puppeteer capture runner. */

import type {
  StoryEntry,
  StorySourceAdapter,
  Viewport,
} from "@storyshelf/core/adapter/capture-runner";
import type {
  CaptureTarget,
  RemoteTarget,
  RenderedSnapshot,
} from "@storyshelf/core/adapter/capture-runner";
import type { StoryParameters } from "@storyshelf/core/capture";
import type { Logger } from "@storyshelf/core/logger";
import type { SessionGate } from "@storyshelf/core/utils";
import type { Browser } from "puppeteer-core";
import type { PagePool } from "./pages.ts";

/** Input for a Puppeteer capture run over a built Storybook directory. */
export interface PuppeteerRenderInput {
  buildId: string;
  /** This call\'s cancel handle within the build (a shard id); defaults to the build id. */
  runId?: string | undefined;
  storybookDir: string;
  stories: StoryEntry[];
  viewports: Viewport[];
  logger?: Logger;
  executePlay?: boolean;
  playTimeoutMs?: number;
  runA11y?: boolean;
  /** Target to render on; the runner's default (first) target when absent. */
  target?: CaptureTarget;
  /**
   * The build's Storybook at a URL the target's browser can reach (ADR 0007, decision 5), which
   * every remote target requires: Puppeteer's remote browsers cannot route back to this host. The
   * loopback server is not started when it is given.
   */
  storybookUrl?: string;
  /** Max pages rendering at once (default: sized from detected CPU and memory). */
  concurrency?: number;
  /** Per-page timeout in ms (default: scaled up on CPU-starved hosts). */
  navigationTimeoutMs?: number;
  /** Restart the browser after this many captures to bound its slow growth (0 disables; default 150). */
  recycleBrowserEvery?: number;
  /** Reuse pages between captures instead of opening one per capture (opt-in; default off). */
  reusePages?: boolean;
  /** Streaming hand-off: receives each capture instead of it being collected in the result. */
  onCapture?: (capture: RenderedSnapshot) => Promise<void>;
  /** Test/extension seam: story source adapter (defaults to `StorybookAdapter`). */
  adapter?: StorySourceAdapter;
}

/** Starts (or connects to) a browser for a target; a failure is a `TargetLaunchError`. */
export type LaunchTarget = (target: CaptureTarget, logger?: Logger) => Promise<Browser>;

/** What the pipeline needs of a target beyond starting it. */
export interface TargetDriver {
  launch: LaunchTarget;
  /** The remote service entry behind `target`; absent for a local engine. */
  remote(target: CaptureTarget): RemoteTarget | undefined;
}

/** The render input as the pipeline runs it: with the session gate of a remote target. */
export type RunInput = PuppeteerRenderInput & { gate?: SessionGate | undefined };

/** Browser + adapter context shared by screenshot helpers. */
export interface ScreenshotContext {
  browser: Browser;
  /** Present when page reuse is on; replaced together with the browser. */
  pagePool?: PagePool;
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
