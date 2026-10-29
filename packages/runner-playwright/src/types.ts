/** Shared types for the Playwright capture runner. */

import type {
  CaptureTarget,
  RemoteTarget,
  RenderedSnapshot,
  StoryEntry,
  StorySourceAdapter,
  Viewport,
} from "@storyshelf/core/adapter/capture-runner";
import type { StoryParameters } from "@storyshelf/core/capture";
import type { Logger } from "@storyshelf/core/logger";
import type { SessionGate } from "@storyshelf/core/utils";
import type { Browser } from "playwright-core";
import type { PagePool } from "./pages.ts";

/** Input for a Playwright capture run over a built Storybook directory. */
export interface PlaywrightRenderInput {
  buildId: string;
  /** This call\'s cancel handle within the build (a shard id); defaults to the build id. */
  runId?: string | undefined;
  /** The shard's 1-based position in the build's plan (handed to a remote service's `acquire`). */
  shardIndex?: number | undefined;
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
   * The build's Storybook at a URL the target's browser can reach (ADR 0007, decision 5), which a
   * `reach: "url"` target requires; the loopback server is not started when it is given.
   */
  storybookUrl?: string;
  /** Max pages rendering at once (default: sized from detected CPU and memory). */
  concurrency?: number;
  /** Per-page navigation/action timeout in ms (default: scaled up on CPU-starved hosts). */
  navigationTimeoutMs?: number;
  /** Restart the browser after this many captures to bound its slow growth (0 disables; default 150). */
  recycleBrowserEvery?: number;
  /** Reuse pages between captures instead of opening one per capture (opt-in; default off). */
  reusePages?: boolean;
  /** Enable bounded gzip caching on the local capture server. */
  staticCompression?: boolean | undefined;
  /** Streaming hand-off: receives each capture instead of it being collected in the result. */
  onCapture?: (capture: RenderedSnapshot) => Promise<void>;
  /** Test/extension seam: story source adapter (defaults to `StorybookAdapter`). */
  adapter?: StorySourceAdapter;
}

/** Input for running Storybook 10 `.test()` entries (`CaptureRunner.runTests`). */
export interface PlaywrightTestsInput {
  buildId: string;
  runId?: string | undefined;
  storybookDir: string;
  /** The test entries to run (`StoryEntry.parentId` is set). */
  tests: StoryEntry[];
  logger?: Logger;
  /** Timeout for one test (render plus body) in ms (default 10 s). */
  playTimeoutMs?: number;
  target?: CaptureTarget;
  storybookUrl?: string;
  /** Max pages running at once (default: sized from detected CPU and memory). */
  concurrency?: number;
  /** Per-page navigation timeout in ms. */
  navigationTimeoutMs?: number;
  staticCompression?: boolean | undefined;
  adapter?: StorySourceAdapter;
}

/** Input for the parameter pre-pass (a subset of the render input). */
export type ExtractInput = Pick<
  PlaywrightRenderInput,
  "buildId" | "storybookDir" | "stories" | "logger" | "target" | "storybookUrl" | "adapter"
> & { staticCompression?: boolean | undefined };

/** Starts (or connects to) a browser for a target; a failure is a `TargetLaunchError`. */
export type LaunchTarget = (
  target: CaptureTarget,
  logger: Logger | undefined,
  context: LaunchContext,
) => Promise<Browser>;

/** Which run a browser is for, so a remote service can route and lease per shard. */
export interface LaunchContext {
  buildId: string;
  /** The shard's id; the build id when not sharded. */
  runId: string;
  shardIndex?: number | undefined;
  purpose: "render" | "extract" | "tests";
  /** Aborts a pending `connect` when the run is cancelled. */
  signal?: AbortSignal | undefined;
}

/** What the pipeline needs of a target beyond starting it. */
export interface TargetDriver {
  launch: LaunchTarget;
  /** The remote service entry behind `target`; absent for a local engine. */
  remote(target: CaptureTarget): RemoteTarget | undefined;
}

/** The render input as the pipeline runs it: with the session gate of a remote target. */
export type RunInput = PlaywrightRenderInput & {
  gate?: SessionGate | undefined;
  maxPagesPerConnection?: number | undefined;
};

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
  /** How long to wait for Storybook's render-finished event before the fixed wait (see `settle.ts`). */
  settleTimeoutMs?: number;
  logger?: Logger;
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
  /** Aborted by `cancel`, so a `connect` still pending stops too. */
  abort?: AbortController | undefined;
}
