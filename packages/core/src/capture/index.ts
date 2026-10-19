/**
 * Server-side capture runtime: story discovery, rendering orchestration,
 * persistence, and the in-process queue.
 *
 * Pure renderers implement `CaptureRunner` (see `core/adapter/capture-runner`);
 * everything here drives them. Remote workers reuse `executeCaptureJob`
 * against any `CaptureQueue` backend.
 */
export {
  assertBrowserCount,
  assertSupportedBrowsers,
  MAX_BROWSERS,
  parseBrowsers,
  resolveBrowsers,
} from "./browsers.ts";
export {
  buildGlobalsParam,
  filterModes,
  MAX_MODES_PER_STORY,
  modeSlug,
  parseModesAllowlist,
} from "./modes.ts";
export {
  DEFAULT_VIEWPORTS,
  isDisabledStory,
  isFlakyStory,
  type ModeDefinition,
  type ModeMap,
  type ModeViewportValue,
  type StoryEntry,
  type StoryParameters,
  type StorySourceAdapter,
  type StoryViewportConfig,
  type StoryViewportDefinition,
  type Viewport,
} from "./adapter.ts";
export {
  executeCaptureJob,
  type CaptureAttemptRef,
  type CaptureJobInput,
  type CaptureJobOptions,
} from "./orchestrator.ts";
export {
  buildScratchDir,
  removeBuildScratch,
  SCRATCH_DIRNAME,
  SCRATCH_MAX_AGE_MS,
  sweepOrphanedScratch,
  type ScratchSweepOptions,
} from "./scratch.ts";
export { persistCapture, type CaptureContext } from "./pipeline.ts";
export { postStatusesForBuild } from "./status-fanout.ts";
export {
  rediffBuild,
  REDIFFABLE_BUILD_STATUSES,
  type RediffDeps,
  type RediffResult,
} from "./rediff.ts";
export {
  INTERRUPTED_ERROR,
  recoverStalledCapture,
  recoverStuckCaptures,
  STALLED_ERROR,
  type RecoveryDeps,
  type RecoveryResult,
} from "./recovery.ts";
export { ProgressLease, type JobLease } from "./job-lease.ts";
export { InMemoryCaptureQueue, type InMemoryCaptureQueueOptions } from "./queue.ts";
export type { PollableCaptureQueue, PollableJob } from "../adapters/capture-queue.ts";
export {
  STORYBOOK_BUILTIN_VIEWPORTS,
  StorybookAdapter,
  mergeParameters,
  resolveStoryViewports,
} from "./storybook.ts";
export { createDispatchJob, type CaptureDispatchJob, type DispatchDeps } from "./dispatch.ts";
export { extractStorybookToScratch, persistStorybookStatics } from "./statics.ts";
export {
  getScreenshotPlan,
  resolveViewports as resolveCaptureViewports,
  SIZING_DEFAULTS,
  type BoundingBox,
  type ScreenshotPlan,
  type SizingOptions,
} from "./sizing.ts";
export {
  ForkedCaptureQueue,
  type ForkedCaptureQueueOptions,
  type ForkedJobOutcome,
} from "./forked/forked-queue.ts";
export { IpcCaptureQueue } from "./forked/ipc-queue.ts";
export {
  canForkCaptureChild,
  CAPTURE_CONCURRENCY_ENV,
  CAPTURE_WORKER_ROLE,
  forkCaptureChild,
  type ForkOptions,
} from "./forked/fork.ts";
export type { ChildProcessHandle, ParentPort } from "./forked/channel.ts";
export type { ChildMessage, ParentMessage } from "./forked/protocol.ts";
export {
  decideCaptureProcess,
  FORK_MIN_CPUS,
  FORK_MIN_MEMORY_BYTES,
  type ForkDecision,
  type ForkHost,
} from "./forked/decision.ts";
