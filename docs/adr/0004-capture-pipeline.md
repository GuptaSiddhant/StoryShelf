# ADR 0004: Capture Pipeline

Server-side render, pure renderers, `play` and accessibility checks, modes and multi-browser.

## Status

Accepted

Supersedes (archived): ADR 0003, 0015, 0017, 0028

## Context

A visual testing platform must render every Storybook story in a controlled browser and take a
deterministic screenshot. Three architectures were possible:

1. **Client-side capture:** the CLI runs a browser in the user's CI and uploads PNGs. Determinism
   then depends on an arbitrary CI environment, and the CLI ships browser binaries.
2. **Server clones and builds the repository:** needs git credentials, a Docker socket and a
   reconciliation loop on the server.
3. **Server-side render:** the CLI builds Storybook, uploads the static build, and the server
   renders it in an environment it controls.

The renderer also needs a boundary. A runner that loads builds, writes snapshots and sets statuses
couples every implementation to core's models and storage layout. Teams additionally want
interaction tests (`play`), theme and locale globals, multiple browser engines, and Chromatic's
parameter conventions to keep working.

## Decision

### 1. Server-side render

The CLI builds Storybook, zips the static output and uploads it. The server renders the stories in
its own pinned browser environment; it never clones a repository or runs user build scripts.
Everything after upload is asynchronous: the upload returns `202`, and a `capture` job on the
database queue runs with `testing.concurrency` (ADR 0006). Capture exists only on instances with
`testing`; browsers are local or remote (ADR 0007). Playwright is the reference runner; Puppeteer
is the smaller Chromium-only alternative.

### 2. `CaptureRunner` is a pure renderer

A runner turns an extracted Storybook directory, discovered stories and viewports into screenshot
buffers. It owns only rendering: launch/connect, serving the extracted directory, navigation,
`play`, accessibility and screenshots. It touches no database, storage or build state.

- `render` takes `target`, `stories`, `viewports`, optional `executePlay`, `runA11y`, a streaming
  `onCapture` callback and the build's `storybookDir`/`storybookUrl`.
- `RenderResult` carries per-story failures, so one failing story does not abort the run.
- `onCapture` streams each screenshot so a large build never holds every image in memory.
- `cancel(buildId, runId?)` stops the build's renders or one run (a shard).
- `extractParameters` and `runTests` are optional capabilities; a runner without them only sees
  index-declared parameters or cannot run Storybook tests.
- The factory takes no database, storage or logger; a logger is a per-render input.

### 3. Core owns the capture orchestrator

`executeCaptureJob` loads the build and project, marks the build `capturing`, extracts the archive
with path-traversal protection, discovers stories and parameters, builds the capture matrix,
delegates rendering, then persists snapshots, diffs and baselines and finalizes the build. Render
failures still persist good captures and fail the build. `createShelfApp` builds the orchestrator
when `testing` is supplied; `config.scratchDir` defaults to the OS temp directory.

### 4. Story parameters, with Chromatic compatibility

`StoryEntry.parameters` carries `disableSnapshot`, `delay`, `diffThreshold`,
`pauseAnimationAtEnd`, `flakyTest`, `modes` and `a11y`. Values are read from both
`parameters.chromatic` and `parameters.storyshelf`, merged so `storyshelf` wins.

- `extractParameters` loads the preview once per build and returns resolved project, component and
  story parameters. Without it, only parameters present in `index.json` are visible.
- `storyshelf upload` sets `STORYBOOK_BUILD_STORIES_JSON=true`; no `.storybook/main.ts` edit is
  needed. A build made outside `upload` uses runtime extraction.
- `disableSnapshot: true` skips the story entirely: no capture, `play` or failure.
- `parameters.viewport` is captured in addition to the project list (union, deduplicated by name).

### 5. Interaction tests through `play`, opt-in per project

Projects carry `execute_play` (default off) and `play_timeout_ms` (default 10000, range 1000 to
30000), set in Settings > Tests.

- **Off:** the runner ignores `play` and waits for the network plus Storybook's render-finished
  signal before the screenshot.
- **On:** the runner executes `play` before the screenshot; the post-`play` frame is the baseline.
- A `play` failure is a blocking failure: the build becomes `failed`; there is no reviewer waive.
- A story tagged `flaky-test` (case-insensitive) or with `flakyTest: true` is flaky. Flaky stories
  are rendered, but their failures keep the snapshot `failed` without failing the build; the UI
  and commit statuses show warnings.

Finalize status: blocking failures ⇒ `failed`; otherwise no changes ⇒ `approved`; otherwise
`reviewing`. ADR 0009 and ADR 0013 add the per-branch and review rules.

### 6. Accessibility checks

With `runA11y` (on by default via `projects.run_a11y`, switched in Settings > Tests) the runner
runs axe-core after the story settles and before the screenshot, once per story, mode and viewport,
on the primary target only.

- Results are annotations, stored on the snapshot and shown in review; they never block or change
  a status. The snapshot's `browser` names the target that produced them.
- Core owns `axe-core` (exact pin), the lazy loader, the run-plan resolver, the in-page functions
  and the pure result mapper; runners keep only a thin `checkA11y(page)`.
- The axe source is evaluated as a string (not injected by URL), so it works under a page CSP and
  over a connected remote browser.
- The default scan is `#storybook-root` with WCAG A/AA plus `best-practice`; story
  `parameters.a11y` can disable, change or scope it. Function values are dropped before they cross
  into the page and the count is logged.
- A failed axe run is one non-blocking `axe unavailable: <reason>` note, not a finding; every
  count and filter excludes it and review shows it separately.
- There is no hand-rolled fallback: a failed run is visible, never a silent pass.

### 7. Modes are named and come from story parameters

Modes follow Chromatic: `parameters.chromatic.modes` and `parameters.storyshelf.modes`, merged per
name (`storyshelf` wins). A mode is `{ viewport?, disable?, ...globals }`.

- Identity is the name's slug (`modeSlug`), stored in `viewport_name`; changing what a mode does
  keeps the same baseline. `globalTypes` is not scanned.
- Globals reach Storybook through the `globals=` URL argument; `viewport` sizes the page and is not
  forwarded. Verified on Storybook 8, 9 and 10.
- Guards: at most 8 captures per story and 3 targets per project. Parameter-defined modes are
  checked again after extraction and fail before rendering; `modesAllowlist` filters them.

### 8. Multi-browser capture over capture targets

A project's `browsers` is a target list, primary first, falling back to `browser`. A target is an
engine (`chromium`, `firefox`, `webkit`, `chrome`) or `<engine>@<name>` for a remote target (ADR
0007).

- One extraction, targets in sequence; runners stay single-target per render call.
- Snapshots, baselines, diffs and storage are keyed by target (`<mode>~<target>` except local
  `chromium`); the target is part of the capture fingerprint (ADR 0005).
- A new target bootstraps from the primary target's clean snapshot; images are never copied across
  targets, since rendering differences would diff everything.
- One approval covers a story and mode across targets, atomic on drift unless `force` is passed;
  per-snapshot approve/reject remains the escape hatch. A failure on any target fails the story.

### 9. Render-settled signalling

The runner waits for Storybook's render-finished event, not a clock. Storybook remains a black box:
the contract is `iframe.html` and the public `Channel.on` API of the preview channel; no internal
postMessage protocol and nothing is patched.

- A recorder registered before the page's scripts hooks the channel and records
  `storyRendered`, `storyFinished`, error/missing events and play exceptions, so events that fired
  before capture asked are not missed.
- Settled means a terminal event arrived; the runner then waits for `document.fonts.ready` and two
  painted frames (capped at 250 ms), then `parameters.delay` when set.
- A page with no channel falls back at once; a channel that never announces falls back after the
  wait (5 s, or the play timeout when plays run) to `delay ?? 500` ms.
- Rendering/play errors are still photographed and logged with the last render phase. This is
  diagnostics only: no schema, status or failure change.
- On the fixtures, screenshots are byte-identical to fixed-wait capture and a 15-story build is
  about 30 % faster.

### 10. Storybook 10 `.test()` entries as interaction tests

Storybook 10's `story.test("name", fn)` creates index entries with `subtype: "test"` and `parent`.
`discover` leaves them out. With `projects.run_tests` on (default off, because it changes what a
build contains), the orchestrator runs them once per build.

- Opening `iframe.html?id=<test id>&viewMode=story` renders the parent and runs the test as its
  play function, so the runner observes the same channel events as decision 9.
- `CaptureRunner.runTests?(input)` returns pass/fail per entry with the failure message and no
  screenshot, on the primary target. A test that exceeds the play timeout fails with its last
  phase.
- A failing test is a blocking failure of its own id, exactly like a throwing `play`; a flaky
  story's test does not fail the build. `skip`/`disableSnapshot` stories skip their tests.
- Results live in one nullable JSON column, `builds.test_results`, written once before sharding.
  No table, status, webhook or notification topic; MCP and the CLI do not expose it.
- Tests run for every build regardless of affected capture; Storybook before 10 has none.

## Consequences

**Positive**

- The server controls rendering determinism; the CLI stays a thin zip-and-upload client, and a
  build can be re-captured without re-uploading.
- Runners follow the same purity standard as other adapters (ADR 0001); a new runner is a
  dependency swap, not a copy of orchestration.
- One gate covers visual and interaction checks; Chromatic users migrate without parameter changes.
- Reviewers decide once per story and mode, with per-target tabs for inspection.

**Negative**

- The upload is the full static build; the server must serve extracted statics during capture.
- Rendering is the scaling bottleneck; ADR 0005 and ADR 0007 address throughput.
- Flaky stories still cost capture time and storage.
- Puppeteer is Chromium-only and sees only index-declared parameters.
- Baselines of a removed mode are not pruned.
- Shared approval differs from Chromatic, which reviews browsers separately.
- Settled signalling depends on Storybook's public event names; a rename falls back to the fixed
  wait (slower, not wrong).
- A build's `.test()` results are overwritten by every capture run, not kept per attempt.

## Alternatives considered

| Alternative                                                     | Why rejected                                                     |
| --------------------------------------------------------------- | ---------------------------------------------------------------- |
| Client-side capture in the user's CI                            | Determinism depends on the CI environment; CLI ships browsers    |
| Server clones and builds the repository                         | Git credentials, Docker socket and a reconciliation loop         |
| Puppeteer, BackstopJS or the Storybook test-runner as reference | Chromium-only, full-page only, or needs a running server         |
| Runner that orchestrates                                        | Every runner re-implements orchestration and couples to storage  |
| Execute `play` unconditionally                                  | Breaks repositories whose `play` functions are dev-only demos    |
| Reviewer waive for failed `play`                                | Flakiness belongs in code (`flaky-test`), not a review click     |
| Custom flaky tag or per-viewport flaky                          | Unneeded complexity; tags are story-level                        |
| Parameters from `index.json` only                               | Storybook 8 omits them, silently ignoring `disableSnapshot`      |
| Canonical query string as mode identity                         | Any value change creates a new baseline                          |
| Copy chromium baselines to a new target                         | Font and anti-aliasing differences diff everything               |
| Render targets in parallel                                      | Memory multiplies per engine                                     |
| Call `play` through the story store for `.test()`               | The iframe URL already runs it; store internals differ           |
| A `build_tests` table or build status for tests                 | A JSON column and the existing failure lane suffice              |
| Separate approval per target                                    | Review load scales with targets; token bumps become unreviewable |
