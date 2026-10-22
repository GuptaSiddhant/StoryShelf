# ADR 0004: Capture Pipeline

Server-side render, pure renderers, `play` and accessibility checks, modes and multi-browser.

## Status

Accepted

Supersedes (archived): ADR 0003, 0015, 0017, 0028

## Context

The core feature a visual testing platform needs is automated screenshot capture: render each
Storybook story in a controlled browser and take a pixel-perfect screenshot. Three architectures
were possible:

1. **Client-side capture:** the CLI runs a browser in the user's CI and uploads PNGs. Rendering
   determinism then depends on an arbitrary CI environment, and the CLI ships about 150 MB of
   browser binaries.
2. **Server clones the repository** and builds Storybook itself. This needs git credentials on the
   server, a Docker socket, and a reconciliation loop for build jobs.
3. **Server-side render:** the CLI builds Storybook, uploads the static build, and the server
   renders it in an environment it controls.

The capture adapter also needs a boundary. A renderer that loads builds, writes snapshots and sets
statuses couples every implementation to core's models and storage layout, so each new runner
would re-implement orchestration.

Teams also want StoryShelf to be the CI gate for interaction tests (Storybook `play` functions),
to test theme and locale globals, and to cover more than one browser engine, with Chromatic's
parameter conventions working unchanged.

## Decision

### 1. Server-side render

The CLI builds Storybook (or reuses an existing build), zips the static output, and uploads it. The
server renders the stories in its own pinned browser environment. The server never clones a
repository and never runs user build scripts.

Everything after upload is asynchronous. The upload returns `202 Accepted`, and a `capture` job on
the database queue runs the capture with the configured concurrency (`testing.concurrency`; ADR
0006, Testing Option, Hosting-Only Mode and the Database Queue). Capture runs only on instances
with `testing` configured. Browsers are local or remote (ADR 0007, Remote Browsers and Public
Origin).

**Playwright** is the reference runner: multi-browser, deterministic rendering, Docker images
available. A Puppeteer runner exists for a smaller Chromium-only image.

### 2. `CaptureRunner` is a pure renderer

A runner turns an already-extracted Storybook directory, a list of discovered stories and a list of
viewports into screenshot buffers. It owns only rendering concerns: launching or connecting to the
browser, serving the extracted directory, navigating, running `play` and accessibility checks, and
screenshotting. It touches no database, storage or build state.

```ts
interface CaptureRunner extends Adapter<{
  readonly category: "capture-runner";
  readonly targets: readonly {
    target: CaptureTarget; // the first entry is the runner's default target
    reach: "loopback" | "url";
    status: "ready" | { unavailable: string };
  }[];
}> {
  render(input: {
    buildId: string;
    runId?: string; // this call's cancel handle within the build (a shard id)
    storybookDir: string; // always the extracted build on this host
    storybookUrl?: string; // set by core for `reach: "url"` targets (ADR 0007)
    target: CaptureTarget;
    stories: StoryEntry[];
    viewports: Viewport[];
    executePlay?: boolean;
    playTimeoutMs?: number;
    runA11y?: boolean;
    onCapture?: (capture: RenderedSnapshot) => Promise<void>; // streaming hand-off
    logger?: Logger;
  }): Promise<RenderResult>; // { captures, failures }

  extractParameters?(input: {
    buildId: string;
    storybookDir: string;
    storybookUrl?: string;
    stories: StoryEntry[];
    target?: CaptureTarget;
    logger?: Logger;
  }): Promise<Record<string, StoryParameters>>;

  cancel(buildId: string, runId?: string): Promise<void>;
}
```

- `RenderResult` carries per-story `failures`, so one failing story does not abort the run.
- `onCapture` streams each screenshot to the caller as it is taken, so a large build never holds
  every screenshot in memory.
- `cancel` without a `runId` stops every render of the build; with one it stops that run only.
- The runner factory takes no database, storage or logger. A logger is only ever a per-render
  input.

### 3. Core owns the capture orchestrator

`executeCaptureJob` in core is the job runner. Given a build id and its dependencies (database,
storage, runner, scratch directory, logger) it:

1. loads the build and project and marks the build `capturing`;
2. extracts the uploaded archive into the scratch directory, with path-traversal protection
   (extraction and its security boundary live in core);
3. discovers stories (`StorybookAdapter`) and resolves their parameters;
4. builds the capture matrix (stories x viewports and modes x targets);
5. delegates rendering to the runner;
6. persists snapshots, diffs and baselines and finalizes the build, passing render failures so a
   build whose story failed is still marked `failed` while its good captures persist.

`createShelfApp` builds the orchestrator when `testing` is supplied. `config.scratchDir` is
optional and defaults to the OS temp directory.

### 4. Story parameters, with Chromatic compatibility

`StoryEntry.parameters` holds `disableSnapshot`, `delay`, `diffThreshold`, `pauseAnimationAtEnd`,
`flakyTest` and `modes`. Each is read from both `parameters.chromatic` and `parameters.storyshelf`,
merged as `{ ...chromatic, ...storyshelf }`, so existing Chromatic repositories work unchanged and
the `storyshelf` key wins.

- **Source.** `index.json` rarely carries parameters, so the optional
  `CaptureRunner.extractParameters` loads the preview once per build, before the capture matrix is
  built, and returns the fully resolved parameters (project, component and story levels stacked).
  A runner without it (Puppeteer) only sees parameters present in the index.
- **CLI.** When `storyshelf upload` runs the Storybook build, it sets
  `STORYBOOK_BUILD_STORIES_JSON=true`, so no `.storybook/main.ts` edit is needed. A Storybook built
  outside `upload` is covered by the runtime extraction.
- **`disableSnapshot: true`** skips the story entirely: no capture, no `play`, not counted, never
  `failed`. The orchestrator filters these before rendering.
- **Per-story viewports.** `parameters.viewport` resolves against Storybook's built-in minimal
  viewports and is captured in addition to the global viewport list (union, deduplicated by name).

### 5. Interaction tests through `play`, opt-in per project

Projects carry `execute_play` (default off) and `play_timeout_ms` (default 10000, range 1000 to
30000), set on the project's Tests settings tab by a project admin.

- **Off:** the runner ignores `play` and waits for the network to settle plus a short fixed delay
  before the screenshot.
- **On:** the runner executes each story's `play` function before the screenshot. The screenshot
  after `play` is the visual baseline.
- **A `play` failure blocks the build** (`failed`). There is no reviewer waive in the review UI.
- **Flaky stories do not block.** A story is flaky when it has the tag `flaky-test`
  (case-insensitive) or `flakyTest: true` in its merged parameters. Flaky is whole-story, not
  per-viewport. Flaky stories are still rendered; their failures keep the snapshot's test status
  `failed` but do not fail the build, and the UI and commit statuses show them as warnings.

Build status at finalize:

```
hasBlocking = blocking failures exist
status = hasBlocking ? "failed" : (changedCount === 0 ? "approved" : "reviewing")
```

The per-branch acceptance rules of ADR 0009 (Baselines, Approval and Retention) and ADR 0013 (UI
Review) apply on top of this.

### 6. Accessibility checks

With `runA11y` (on by default, `projects.run_a11y`; a project admin turns it off in Settings > Tests or the project API) the runner runs [axe-core](https://github.com/dequelabs/axe-core) in the page after
the story settles and before the screenshot, once per story, mode and viewport. Results are
annotations: they are stored on the snapshot (`snapshots.a11y_violations`, a JSON array of the
annotation strings, null when none) and shown in review, but never block the build or change its
status.

- **Ownership.** `@storyshelf/core` owns `axe-core` (exact pin) and the shared pieces under
  `capture/a11y/`, re-exported from `@storyshelf/core/capture`: a lazy, cached loader of
  `axe.min.js`, the `parameters.a11y` to run-plan resolver, the two in-page functions and the pure
  result mapper. Runners keep only a thin `checkA11y(page)` and have no axe dependency.
- **Injection.** The axe source is evaluated as a string (`page.evaluate`, a CDP
  `Runtime.evaluate`), guarded by `typeof globalThis.axe`. Not `addScriptTag`: evaluation is not
  bound by the page's CSP and works over a `connect`ed browser, since source travels instead of a
  path. The in-page functions are each one self-contained function (only their source is
  serialised) and return slim fields only (rule id, impact, help, first target, node count), never
  raw axe node html.
- **What is scanned.** `#storybook-root` with the WCAG 2.0/2.1/2.2 A and AA tags plus axe's
  `best-practice` tag (`options.runOnly` replaces the set). The page-level best-practice rules
  (`region`, `landmark-one-main`, `page-has-heading-one`) only run when the whole document is in
  scope, so the default root scan does not flag every isolated story and no rule is disabled by
  default (measured in Chromium); a story that widens `element`/`context` to the page turns them on
  and can switch them off through `config.rules`. The story's
  `parameters.a11y` is read from the preview (`disable: true` or `test: "off"` skip it; `config`,
  `options` and `element`/`context` apply; `test: "todo" | "error"` still only annotate). Only the
  JSON-serialisable subset is readable; `config.rules[].enabled: false` is mirrored into the run
  options so it also holds under a tag-based `runOnly`.
- **Annotation format.** One string per violation, worst impact first:
  `<rule> (<impact>): <help> [<selector>] <n> node(s)`, at most 10, then `…and N more`. The runner
  joins them as `a11y: a; b; …` in a render failure, so core's `startsWith("a11y:")` classification
  and story-id sets are unchanged. The runner also attaches the strings to the `RenderedSnapshot`
  (`a11y`), the pipeline stores them as JSON on that capture's snapshot row, and the review page,
  filmstrip and component page read them from there (`pages/a11y-violations.tsx`).
- **No fallback.** There is no hand-rolled scan. If axe cannot be loaded or run, the result is one
  visible, non-blocking annotation `a11y: axe unavailable: <reason>` plus a warning log, never a
  silent pass.

### 7. Modes are named and come from story parameters

Modes follow Chromatic's model: `parameters.chromatic.modes` and `parameters.storyshelf.modes`, at
project, component or story level, merged per mode name (`storyshelf` wins). A mode is
`{ viewport?, disable?, ...globals }`.

- **Identity is the name.** A mode's baseline key is the slug of its name (`modeSlug`), so changing
  what a mode does keeps comparing against the same baseline. `globalTypes` is not scanned. The
  slug is stored in `viewport_name`; a mode named like a viewport replaces it. `disable: true` drops
  an inherited mode or a viewport of the same name. The applied globals (`mode`, JSON) are display
  and capture metadata only.
- **Globals reach Storybook through the `globals=` URL argument** (`a:b;c.d:e`, nested objects
  flattened, `!true` and `!hex()` forms). `viewport` sizes the page and is not forwarded as a
  global. Verified on Storybook 8, 9 and 10: declared globals apply and undeclared ones are ignored.
- **Guards.** At most 8 captures per story (viewports, default viewport and modes) and at most 3
  targets per project. Parameter-defined modes cannot be validated at configuration time, so the
  cap is checked again after extraction and fails the build before rendering. The project's
  `modesAllowlist` filters declared modes.

### 8. Multi-browser capture over capture targets

A project's `browsers` setting is a list of capture targets, primary first, falling back to the
single `browser` column. A target is an engine name (`chromium`, `firefox`, `webkit`, `chrome`) or
`<engine>@<name>` for a remote target (ADR 0007).

- **One extraction, targets in sequence.** The orchestrator loops the targets over one extraction;
  runners stay single-target per render call. Sequential keeps one browser's memory alive at a
  time.
- **Keyed per target.** Snapshots, baselines, diffs and storage paths are keyed by target
  (`<mode>~<target>` for anything other than local `chromium`, which keeps the plain layout).
  Rows with no `browser` mean local `chromium`. The target is part of the capture fingerprint (ADR
  0005, Capture Performance and Sharding).
- **New targets bootstrap, never copy.** A target with no baselines auto-accepts a story or mode's
  first snapshot when the primary target's snapshot of it is clean; otherwise it goes to review as
  `new`. Images are never copied across targets, since rendering differences would diff everything.
- **Shared approval.** One decision covers a story and mode on every target
  (`POST .../stories/:storyId/modes/:modeKey/approve|reject`). It is atomic on drift: if any
  target's baseline moved, nothing is approved unless `force` is passed. `approve-all` skips a whole
  group when one member drifted. Per-snapshot approve and reject remain as the escape hatch ("Only
  <target>"). Review progress, the filmstrip and previous/next count story and mode groups, not
  target rows.
- A failure on any target fails the story, since failures are keyed per story.

## Consequences

**Positive**

- The server controls rendering determinism; the CLI stays a thin zip-and-upload client with no
  browser dependency, and re-capturing an existing build needs no re-upload.
- Runners follow the same purity standard as the other adapters (ADR 0001, Architecture and
  Conventions): a new runner, local or remote, is a dependency swap, not a copy of orchestration.
- One gate covers visual and interaction checks, so teams can drop a separate `storybook test` CI
  step. Chromatic users migrate with no parameter changes.
- Reviewers decide once per story and mode, with per-target tabs for inspection.

**Negative**

- The upload is the full static build (tens of MB). The server must serve the extracted statics
  over HTTP during capture.
- Rendering is the scaling bottleneck: every build re-renders the stories it captures. ADR 0005 and
  ADR 0007 address throughput.
- Flaky stories still cost capture time and storage, unlike `disableSnapshot`.
- Puppeteer renders only Chromium and only sees index-declared modes.
- Baselines of a removed mode are not pruned.
- Shared approval differs from Chromatic, which reviews browsers separately.

## Alternatives considered

| Alternative                                                         | Why rejected                                                                              |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Client-side capture in the user's CI                                | Determinism depends on the CI environment; CLI ships browsers                             |
| Server clones and builds the repository                             | Git credentials, Docker socket and a reconciliation loop on the server                    |
| Puppeteer, BackstopJS or the Storybook test-runner as the reference | Chromium-only, full-page only, or needs a running Storybook server                        |
| Runner that orchestrates (loads, persists, sets status)             | Every runner re-implements orchestration and couples to core's storage layout             |
| Execute `play` unconditionally                                      | Breaks repositories whose `play` functions are dev-only demos                             |
| Reviewer waive for failed `play`                                    | Flakiness belongs in code (`flaky-test`), not in a review click                           |
| Custom flaky tag name, or per-viewport flaky                        | Unneeded complexity; tags are story-level                                                 |
| Parameters from `index.json` only                                   | Storybook 8's index omits parameters, silently ignoring `disableSnapshot` and `flakyTest` |
| Canonical query string as mode identity                             | Any value change creates a new baseline; diverges from Chromatic                          |
| Copy chromium baselines to a new target                             | Font and anti-aliasing differences make every story diff                                  |
| Render targets in parallel                                          | Memory multiplies per engine                                                              |
| Separate approval per target                                        | Review load scales with targets; token bumps become unreviewable                          |
