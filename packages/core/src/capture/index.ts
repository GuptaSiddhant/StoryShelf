/**
 * Server-side capture runtime (testing only): story discovery, rendering orchestration,
 * persistence, rediff and the `capture` job handler. The hosting side lives in `/jobs`, `/publish`,
 * `/build-state` and `/catalog`; the stored-result readers in `/models`.
 *
 * Pure renderers implement `CaptureRunner` (see `core/adapter/capture-runner`, which also
 * re-exports the helpers a runner reuses); everything here drives them.
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
export { switchStoriesEnabled, switchStoriesVetoed } from "./switch-stories.ts";
export {
  NO_ORIGIN_REASON,
  NO_SECRET_REASON,
  offeredTargets,
  type TargetPrerequisites,
} from "./targets.ts";
export { storybookUrlSource, type StorybookUrlSource } from "./storybook-urls.ts";
export {
  cleanIgnoreSelectors,
  declaredIgnoreSelectors,
  DEFAULT_IGNORE_SELECTORS,
  ignoreStylesheet,
  isSafeIgnoreSelector,
  MAX_IGNORE_SELECTORS,
  type IgnoreSelectorList,
} from "./ignore-regions.ts";
export {
  buildGlobalsParam,
  filterModes,
  MAX_MODES_PER_STORY,
  modeSlug,
  parseModesAllowlist,
} from "./modes.ts";
export {
  executeCaptureJob,
  type CaptureAttemptRef,
  type CaptureJobInput,
  type CaptureJobOptions,
} from "./orchestrator.ts";
export {
  buildFingerprint,
  changedFields,
  fingerprintHash,
  parseFingerprint,
  type EnvironmentChange,
  type Fingerprint,
} from "./fingerprint.ts";
export { persistCapture, type CaptureContext } from "./pipeline.ts";
export {
  rediffBuild,
  REDIFFABLE_BUILD_STATUSES,
  type RediffDeps,
  type RediffResult,
} from "./rediff.ts";
export { failCrashedCapture, type CrashFailureOutcome } from "./crash-failure.ts";
export {
  captureDispatchDeps,
  createCaptureHandler,
  type CaptureHandlerOptions,
} from "./capture-handler.ts";
export { runCaptureChild, type CaptureChildOptions, type ChildHost } from "./forked/child.ts";
export {
  STORYBOOK_BUILTIN_VIEWPORTS,
  StorybookAdapter,
  mergeParameters,
  resolveStoryViewports,
} from "./storybook.ts";
export { createDispatchJob, type CaptureDispatchJob, type DispatchDeps } from "./dispatch.ts";
export { MissingContentError, materializeStorybook, prepareStorybook } from "./materialize.ts";
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

export {
  isComparisonImagePath,
  parseComparisonReference,
  type ComparisonReference,
} from "./comparison-reference.ts";
export {
  launchFailureOf,
  reachabilityOf,
  reasonClassOf,
  TargetReachability,
  type ReachabilityChange,
  type UnreachableReason,
  type UnreachableTarget,
} from "./target-reachability.ts";
