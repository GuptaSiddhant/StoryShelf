# ADR 0015: Pure Capture Renderer Adapter

## Status

Accepted

## Context

The `CaptureRunner` adapter (`run(buildId)`) originally did far more than render. `@storyshelf/runner-playwright`'s `createPlaywrightCaptureRunner({ db, storage, dataDir, logger })` closed over the database and storage and, on `run(buildId)`, loaded the build/project via the models, set the build `capturing`, extracted the uploaded archive from storage, served the statics, rendered every story via `runCapture`, diffed and wrote snapshots/baselines, and set the terminal build status. That made the adapter a mini-orchestrator coupled to server concerns.

That was fine for a single local implementation but is a poor standard for the adapter family: any future runner (`runner-remote` offloading capture to a worker fleet, a WASM/headless variant, etc.) would have to re-implement loading, status transitions, extraction, and persistence, and each adapter would silently couple to core's models and storage layout.

The repo already formalizes adapter purity elsewhere (ADR 0001 adapter-composition, DB and storage adapters exposing narrow interfaces). The capture adapter was the outlier.

## Decision

### 1. `CaptureRunner` becomes a pure renderer

Adapters implement a single `render(input)` that turns an **already-extracted** Storybook directory plus discovered stories and viewports into PNG screenshot buffers. Return `RenderResult { captures, failures }` so a renderer can report per-story failures without aborting the whole run. `cancel(buildId)` remains for aborting in-flight browser work.

```ts
interface CaptureRunner {
  render(input: {
    buildId: string;
    storybookDir: string;  // extracted Storybook root
    stories: StoryEntry[];
    viewports: Viewport[];
    logger?: Logger;
  }): Promise<RenderResult>;
  cancel(buildId: string): Promise<void>;
}
```

The renderer owns only rendering concerns: launching the browser, serving the extracted directory as statics, navigating, and screenshotting. It touches **no** database, storage, or build state.

### 2. Core owns a capture orchestrator

`capture/orchestrator.ts` (`executeCaptureJob`) is the server-side job runner the adapter used to be. Given `{ buildId, reqId }` and dependencies `{ db, storage, runner, scratchDir, viewports?, logger }` it:

1. loads the build and project;
2. marks the build `capturing`;
3. extracts the uploaded archive from storage into `scratchDir` (with path-traversal protection);
4. discovers stories (`StorybookAdapter`);
5. delegates rendering to the pure `runner`;
6. persists snapshots/diffs/baselines and finalizes the build (`capture/pipeline.ts`),
   passing any render `failures` so a build whose story failed to render is still marked `failed` while its good captures persist.

`extractStorybook`/path-traversal prevention moved from the runner into core.

### 3. Wiring

`createShelfRouter` builds the orchestrator internally when `capture` is supplied and requires `ShelfConfig.scratchDir` (it throws at construction if missing). The queue runs `executeCaptureJob` instead of `capture.run`. The server (`serve.ts`) constructs the pure runner `createPlaywrightCaptureRunner()` and passes `dataDir` as `scratchDir`.

## Consequences

- The capture-runner adapter family now follows the same purity standard as the DB/storage/auth adapters (ADR 0001). A remote runner is a dependency swap, not a copy of orchestration.
- `core` gains one small dependency (`adm-zip`) for archive extraction and owns the extraction security boundary.
- The renderer factory takes no dependencies (`createPlaywrightCaptureRunner()`); a pino `Logger` is only ever a per-render input. `runCapture`/`RenderStory` are gone; `runCapture` is split into pure `render` (adapter) + `persistCapture` (core).
