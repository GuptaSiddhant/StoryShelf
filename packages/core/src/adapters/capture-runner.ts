/**
 * Capture-runner adapter interface: render story screenshots for a build.
 */
import type { Logger } from "pino";
import type { StoryEntry, Viewport } from "../capture/adapter.ts";
import type { AdapterMetadata } from "./metadata.ts";

export type { JobStatus } from "./capture-queue.ts";

/** A screenshot produced by a capture renderer. */
export interface RenderedSnapshot {
  /** The rendered story (echoed back from the render request). */
  story: StoryEntry;
  /** Viewport name the screenshot was captured at. */
  viewportName: string;
  /** PNG screenshot bytes. */
  screenshot: Buffer;
}

/** A story/viewport that a renderer could not capture. */
export interface RenderFailure {
  /** Story that failed to render. */
  storyId: string;
  /** Viewport that failed to render. */
  viewportName: string;
  /** Error message. */
  error: string;
}

/** The outcome of a render request. */
export interface RenderResult {
  /** Screenshots the renderer produced successfully. */
  captures: RenderedSnapshot[];
  /** Story/viewport pairs the renderer could not capture. */
  failures: RenderFailure[];
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
export interface CaptureRunner {
  /** Adapter identity. */
  readonly metadata?: AdapterMetadata;
  /**
   * Render configured viewports for the given stories of an extracted
   * Storybook and return the screenshot buffers.
   *
   * @param input - Render request with the extracted Storybook directory.
   */
  render(input: {
    /** Build being captured, used to correlate cancels with in-flight work. */
    buildId: string;
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
  }): Promise<RenderResult>;

  /** Cancel a pending or in-flight render for a build. */
  cancel(buildId: string): Promise<void>;
}
