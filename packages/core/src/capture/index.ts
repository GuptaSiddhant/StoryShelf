/**
 * Server-side capture runtime: story discovery, rendering orchestration,
 * persistence, the database job queue and the consumer that runs its jobs.
 *
 * Pure renderers implement `CaptureRunner` (see `core/adapter/capture-runner`);
 * everything here drives them.
 */
export {
  assertBrowserCount,
  assertSupportedBrowsers,
  listTargets,
  MAX_BROWSERS,
  parseBrowsers,
  primaryTargetOf,
  refusalFor,
  resolveBrowsers,
} from "./browsers.ts";
export {
  NO_ORIGIN_REASON,
  NO_SECRET_REASON,
  offeredTargets,
  type TargetPrerequisites,
} from "./targets.ts";
export { storybookUrlSource, type StorybookUrlSource } from "./storybook-urls.ts";
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
export { parseTestResults, summarizeTests, type TestResult, type TestSummary } from "./tests.ts";
export {
  executeCaptureJob,
  type CaptureAttemptRef,
  type CaptureJobInput,
  type CaptureJobOptions,
} from "./orchestrator.ts";
export {
  buildScratchDir,
  removeBuildScratch,
  removeJobScratch,
  SCRATCH_DIRNAME,
  SCRATCH_MAX_AGE_MS,
  sweepOrphanedScratch,
  type ScratchSweepOptions,
} from "./scratch.ts";
export {
  buildFingerprint,
  changedFields,
  fingerprintHash,
  parseFingerprint,
  type EnvironmentChange,
  type Fingerprint,
} from "./fingerprint.ts";
export {
  axeInjectionScript,
  A11Y_ROOT_SELECTOR,
  inPageReadA11yParameters,
  inPageRunAxe,
  loadAxeSource,
  mapAxeViolations,
  MAX_REPORTED_VIOLATIONS,
  resolveA11yRun,
  type A11yRunPlan,
  type SlimViolation,
} from "./a11y/index.ts";
export { persistCapture, type CaptureContext } from "./pipeline.ts";
export * from "./build-state/index.ts";
export {
  rediffBuild,
  REDIFFABLE_BUILD_STATUSES,
  type RediffDeps,
  type RediffResult,
} from "./rediff.ts";
export { failCrashedCapture, type CrashFailureOutcome } from "./crash-failure.ts";
export { ProgressLease, type JobLease } from "./job-lease.ts";
export {
  createDatabaseCaptureQueue,
  DATABASE_QUEUE_METADATA,
  DEFAULT_LEASE_MS,
  DEFAULT_RETRIES,
  LEASE_EXHAUSTED_ERROR,
  MAX_NACK_DELAY_MS,
  type DatabaseCaptureQueue,
  type DatabaseCaptureQueueOptions,
  type DatabaseJob,
  type QueueJobInput,
} from "./db-queue/index.ts";
export {
  ACTIVE_POLL_MS,
  ACTIVE_WINDOW_MS,
  CANCEL_CHECK_MS,
  DEFAULT_CADENCE,
  IDLE_POLL_MS,
  nextPollDelay,
  POLL_JITTER,
  type PollCadence,
} from "./db-queue/cadence.ts";
export {
  keepJobLease,
  RENEW_THROTTLE_MS,
  type JobLeaseKeeper,
  type LeaseEnd,
  type LeaseKeeperOptions,
} from "./db-queue/keeper.ts";
export { startPollLoop, type PollLoop, type PollLoopOptions } from "./db-queue/poll-loop.ts";
export {
  backoffDelayMs,
  captureDispatchDeps,
  createCaptureConsumer,
  createCaptureHandler,
  DEFAULT_BACKOFF_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_SAMPLE_MS,
  DEFAULT_WAIT_TIME_SECONDS,
  idleDelayMs,
  isFastEmptyPoll,
  isFinalAttempt,
  MAX_BACKOFF_MS,
  MIN_BLOCKING_POLL_MS,
  sampleQueue,
  type CaptureConsumer,
  type CaptureConsumerOptions,
  type CaptureHandlerOptions,
  type ConsumerConfig,
  type ConsumerJob,
  type ConsumerMetrics,
  type JobFinishedEvent,
  type JobHandlers,
  type JobOutcome,
  type JobRunContext,
  type KindHandler,
  type QueueSample,
  type RetryConfig,
} from "./consumer/index.ts";
export { runCaptureChild, type CaptureChildOptions, type ChildHost } from "./forked/child.ts";
export type { LeaseRenewal, PollableCaptureQueue, PollableJob } from "../adapters/capture-queue.ts";
export {
  STORYBOOK_BUILTIN_VIEWPORTS,
  StorybookAdapter,
  mergeParameters,
  resolveStoryViewports,
} from "./storybook.ts";
export { createDispatchJob, type CaptureDispatchJob, type DispatchDeps } from "./dispatch.ts";
export { extractStorybookToScratch, persistStorybookStatics } from "./statics.ts";
export * from "./publish/index.ts";
export * from "./catalog/index.ts";
export {
  getScreenshotPlan,
  resolveViewports as resolveCaptureViewports,
  SIZING_DEFAULTS,
  type BoundingBox,
  type ScreenshotPlan,
  type SizingOptions,
} from "./sizing.ts";
export {
  createForkedCaptureHandler,
  type ForkedCaptureHandler,
  type ForkedCaptureOptions,
} from "./forked/forked-capture.ts";
export {
  canForkCaptureChild,
  CAPTURE_RETRIES_ENV,
  CAPTURE_SHARD_SIZE_ENV,
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
