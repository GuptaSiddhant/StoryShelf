---
"@storyshelf/core": minor
"@storyshelf/app": patch
"@storyshelf/runner": patch
---

Breaking: hosting code leaves core's `/capture` for `/jobs`, `/publish`, `/build-state`, `/catalog`

`@storyshelf/core/capture` now holds testing code only (#1364). Import from the new subpaths instead:

- `/jobs`: `createDatabaseCaptureQueue`, `createCaptureConsumer`, the poll cadence, `keepJobLease`, `startPollLoop`, `ProgressLease` and the consumer types.
- `/publish`: the publish handler and completer, extraction limits, `persistStorybookStatics`, `recordContentUses` and the scratch helpers.
- `/build-state`: the build-state publisher, the `notify` job and repository-link delivery.
- `/catalog`: the catalog loader, hook and readers.
- `/models`: `parseTestResults`, `summarizeTests` and the a11y note helpers (`isA11yNote`, `axeUnavailableNote`, ...).
- `/adapter/capture-runner`: the story types (`StoryEntry`, `StoryParameters`, `Viewport`, ...), `DEFAULT_VIEWPORTS`, `isFlakyStory`, `isDisabledStory`, plus what a runner reuses (`StorybookAdapter`, `mergeParameters`, `resolveStoryViewports`, sizing, ignore regions, a11y notes).

`createCaptureConsumer` no longer takes `capture`, `images` or `compare`: register `createCaptureHandler(...)` (still in `/capture`) under `handlers.capture`. A handler may declare `prepare(logger)`, awaited before the first poll; the capture handler's loads the image engine, as before.
