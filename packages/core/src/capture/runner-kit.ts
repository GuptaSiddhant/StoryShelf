/**
 * The `@storyshelf/core/adapter/capture-runner` entry: the runner contract
 * (`adapters/capture-runner.ts`) plus the capture helpers a runner reuses, so a runner imports
 * `adapter/*`, `utils` and `logger`, never `/capture` (#1364). It lives here, not in `adapters/`,
 * because no adapter definition may import `capture/` (`no-testing-imports.test.ts`).
 */
export * from "../adapters/capture-runner.ts";
export {
  DEFAULT_VIEWPORTS,
  isDisabledStory,
  isFlakyStory,
  type CapturePage,
  type DiscoverOptions,
  type ModeDefinition,
  type ModeMap,
  type ModeViewportValue,
  type StoryParameters,
  type StoryViewportConfig,
  type StoryViewportDefinition,
} from "../adapters/story-source.ts";
export {
  STORYBOOK_BUILTIN_VIEWPORTS,
  StorybookAdapter,
  mergeParameters,
  resolveStoryViewports,
} from "./storybook.ts";
export {
  getScreenshotPlan,
  resolveViewports as resolveCaptureViewports,
  SIZING_DEFAULTS,
  type BoundingBox,
  type ScreenshotPlan,
  type SizingOptions,
} from "./sizing.ts";
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
  axeUnavailableNote,
  axeUnavailableReason,
  isA11yNote,
  parametersNote,
  parametersReason,
} from "../models/a11y-notes.ts";
