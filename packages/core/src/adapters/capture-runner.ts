/**
 * Capture-runner adapter interface: render story screenshots for a build.
 */
import type { Logger } from "pino";
import type {
  StoryEntry,
  StoryParameters,
  StorySourceAdapter,
  Viewport,
} from "../capture/adapter.ts";
import type { CaptureTarget, RunnerTarget } from "./capture-target.ts";
import type { Adapter } from "./metadata.ts";

export { createTargetOffers, type TargetOffers } from "./capture-target-offers.ts";
export {
  BROWSER_NAMES,
  DEFAULT_BROWSER,
  TARGET_NAME_PATTERN,
  TargetLaunchError,
  engineOf,
  isBrowserName,
  isCaptureTarget,
  parseTarget,
  tryParseTarget,
  unavailableReason,
} from "./capture-target.ts";
export type {
  BrowserName,
  CaptureTarget,
  ParsedTarget,
  RunnerTarget,
  TargetReach,
  TargetStatus,
} from "./capture-target.ts";

export type { JobStatus } from "./capture-queue.ts";
export { RenderRuns } from "./render-runs.ts";
export type { StoryEntry, StorySourceAdapter, Viewport } from "../capture/adapter.ts";

/**
 * The rendering environment a runner captured in. Two captures with the same environment (and
 * engine and viewport) should produce identical pixels; a different one explains a visual diff
 * that no code change caused. Every field is optional: runners report what they can.
 */
export interface CaptureEnvironment {
  /** Browser build, as the driver reports it (for example `124.0.6367.29`). */
  browserVersion?: string;
  /** Host OS and CPU (`process.platform-arch`); text rendering differs between them. */
  platform?: string;
  /** Device pixel ratio the pages were rendered at. */
  deviceScaleFactor?: number;
  /** Digest of the installed system fonts, when they could be listed. */
  fontsHash?: string;
}

/** A screenshot produced by a capture renderer. */
export interface RenderedSnapshot {
  /** The rendered story (echoed back from the render request). */
  story: StoryEntry;
  /** Viewport name the screenshot was captured at. */
  viewportName: string;
  /** Exact viewport dimensions captured at; falls back to the project list lookup in the pipeline. */
  viewport?: Viewport;
  /** PNG screenshot bytes. */
  screenshot: Buffer;
  /** Target that produced the screenshot (the request's `target`); chromium when absent. */
  browser?: CaptureTarget;
  /**
   * Wall-clock milliseconds the renderer spent on this capture, when it measured it. Recorded per
   * snapshot and read back as the per-story cost a shard plan orders its work by (ADR 0031).
   */
  durationMs?: number;
  /**
   * Set by the orchestrator when it already wrote the screenshot to storage
   * (via `onCapture`); `screenshot` is then empty and must not be written again.
   * Runners never set this.
   */
  stored?: boolean;
  /** Where the orchestrator stored it (content-addressed); set together with `stored`. */
  storedPath?: string;
  /** Environment of the render pass that produced it; filled in by the orchestrator from {@link RenderResult.environment}. */
  environment?: CaptureEnvironment;
}

/** A story/viewport that a renderer could not capture. */
export interface RenderFailure {
  /** Story that failed to render. */
  storyId: string;
  /** Viewport that failed to render. */
  viewportName: string;
  /** Error message. */
  error: string;
  /** Target the failure happened on; chromium when absent. */
  browser?: CaptureTarget;
}

/** The outcome of a render request. */
export interface RenderResult {
  /** Screenshots the renderer produced successfully. */
  captures: RenderedSnapshot[];
  /** Story/viewport pairs the renderer could not capture. */
  failures: RenderFailure[];
  /** What this render ran on; optional so third-party runners keep working. */
  environment?: CaptureEnvironment;
}

/**
 * A pure capture renderer.
 *
 * Adapters implementing `CaptureRunner` render screenshots from an
 * already-extracted Storybook directory and return PNG buffers. They are
 * intentionally pure: they perform **no** database, storage, or build-state
 * management. Loading the build, extracting the uploaded archive, persisting
 * snapshots/baselines/diffs, and advancing build status are the capture
 * orchestrator's job (see `capture/orchestrator.ts`), keeping every adapter
 * implementation free of server concerns.
 */
export interface CaptureRunner extends Adapter<{
  readonly category: "capture-runner";
  /**
   * Every target the runner offers, default first (ADR 0007, decision 1), with whether each can
   * render now. A runner that omits it offers any target.
   */
  readonly targets?: readonly RunnerTarget[];
}> {
  /**
   * Render configured viewports for the given stories of an extracted
   * Storybook and return the screenshot buffers.
   *
   * @param input - Render request with the extracted Storybook directory.
   */
  render(input: {
    /** Build being captured, used to correlate cancels with in-flight work. */
    buildId: string;
    /**
     * This call's handle within the build, for `cancel(buildId, runId)`: several renders of one
     * build (its shards) can be in flight in one process. Absent, the build id is used.
     */
    runId?: string | undefined;
    /** Root of the already-extracted Storybook build. */
    storybookDir: string;
    /** Stories to render. */
    stories: StoryEntry[];
    /** Viewports to capture. */
    viewports: Viewport[];
    /** Optional logger for render-time diagnostics. */
    logger?: Logger;
    /** Whether to execute Storybook play functions before screenshot. */
    executePlay?: boolean;
    /** Timeout for play function execution in ms. */
    playTimeoutMs?: number;
    /** Whether to run a11y checks (axe) before screenshot; annotated as non-blocking. */
    runA11y?: boolean;
    /** Target to render on (chromium when absent). */
    target?: CaptureTarget;
    /**
     * Optional streaming hand-off. When provided, the runner awaits it with each
     * capture as soon as it is taken, then drops the buffer instead of adding the
     * capture to `RenderResult.captures`, so a large build never holds every
     * screenshot in memory. A rejection is reported as a render failure for that
     * story/viewport. Runners that do not support it return captures as usual.
     */
    onCapture?: (capture: RenderedSnapshot) => Promise<void>;
    /**
     * Test/extension seam: override the story source adapter (defaults to
     * `StorybookAdapter`). Only the renderer uses it; discovery stays the
     * orchestrator's job.
     */
    adapter?: StorySourceAdapter;
  }): Promise<RenderResult>;

  /**
   * Optional pre-pass reading each story's fully resolved parameters (project,
   * component and story levels stacked) from the running preview. Storybook's
   * index rarely carries parameters, so this is how the orchestrator learns
   * which modes a story declares before it builds the capture matrix.
   * Absent or failing, the orchestrator falls back to index parameters.
   */
  extractParameters?(input: {
    buildId: string;
    storybookDir: string;
    stories: StoryEntry[];
    logger?: Logger;
    /** Target to read the parameters on: the project's primary (chromium when absent). */
    target?: CaptureTarget;
    adapter?: StorySourceAdapter;
  }): Promise<Record<string, StoryParameters>>;

  /**
   * Cancel in-flight renders of a build: the ones started with `runId`, or every one of the build
   * when it is absent. Runners can track their calls with {@link RenderRuns}.
   */
  cancel(buildId: string, runId?: string): Promise<void>;
}
