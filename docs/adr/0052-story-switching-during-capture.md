# ADR 0052: Switching Stories Inside One Loaded Page During Capture

## Status

Accepted (2026-11-13, owner). It answers #876. Nothing here ships until the
measurement gate in decision 9 passes; until then the behaviour in Context is the only one.
Statements marked `[inferred]` were not read in the code and must be confirmed by the implementation.

## Context

A capture loads a fresh document for every story and viewport. `runCapture`
(`packages/runner-playwright/src/screenshot.ts`) calls `page.goto(buildUrl(...), { waitUntil:
"networkidle" })`, waits for Storybook's own events (`settle.ts`), optionally runs the play function,
runs axe, masks ignore regions, sizes the page and takes the screenshot. Every story therefore pays
for the document, the preview bundle's parse and run, and Storybook's start-up.

Storybook can move between stories inside one loaded `iframe.html` through its channel
(`setCurrentStory`, then `storyRendered`) `[inferred]`. #876 asks whether capture should do that.

Facts read in the code on 2026-11-13:

- **The settle recorder is per document.** `inPageRecorder` keeps one `settled` flag and one `phase`
  for the page. It is installed with `addInitScript` and never reset, so after a switch it would
  report the previous story as settled.
- **The fresh load's `networkidle` does real work.** It is what waits for a story's images and
  lazy chunks. A switch has no navigation, so that wait disappears unless it is replaced.
- **The runner itself leaves state behind.** `maskIgnoredRegions` adds a style tag,
  `pauseAnimationAtEnd` pauses animations, `settlePage` pauses videos, and a full-page plan calls
  `setViewportSize`. A fresh document hides all of that today.
- **Pages can already be reused.** `reusePages` (`pages.ts`, `PagePool`) keeps a page and its HTTP
  cache between captures, but still navigates for every story and clears storage, Cache Storage,
  service workers and cookies in between.
- **Recovery paths assume a fresh page.** `capture-retry.ts` retries a story, `isolate.ts` narrows a
  browser crash to one story, and the browser is recycled every 150 captures
  (`DEFAULT_RECYCLE_BROWSER_EVERY`).
- **Modes are URL state.** `StorybookAdapter.buildUrl` puts a mode's globals in the `globals` query
  parameter; args are never sent.
- **Signed URLs change during a long pass.** `renderInSlices` mints a new capture base for each
  slice of a remote capture.
- **The benchmark exists.** `nub run bench` (#853, `scripts/bench/`) runs the real app on
  `fixtures/storybook-9`, drops one warm-up run and reports the median of three.

The risk is not speed. It is that a story's picture starts to depend on which stories were rendered
before it on the same page. The product promise is that a result reports what was compared
(AGENTS.md, Architecture direction), so that risk decides the design.

## Decision

### 1. A session is one loaded document

- A **session** is one loaded `iframe.html` on one page. It is bound to one capture target, one
  viewport size, one set of globals and one base URL.
- The first story of a session is a fresh load, exactly as today. Later stories in the session are
  reached with `setCurrentStory` and no navigation.
- Core does not change how it plans work. The runner groups the jobs it is given into sessions.
- A change of viewport, of globals (a mode) or of base URL ends the session. `updateGlobals` is not
  used: a mode is rendered in its own session, so modes keep their URL semantics.

### 2. Off by default, per project, with an operator veto

- A project setting, `projects.switch_stories`, default `false`. It follows the ADR 0041 rule for a
  new column until the neutral tables land.
- A runner option can forbid it for the whole instance. A runner that has not passed the gate does
  not offer it, and the project setting is then ignored with one log line per build.
- A story source other than the built-in Storybook one never switches (ADR 0001 amendment):
  switching is part of Storybook's in-page half.

### 3. Readiness after a switch

- **The same events decide.** `storyRendered`, `storyFinished` and the error events stay the signal.
  The recorder gains a per-story state: the runner resets it with the story id before the switch,
  and only events that carry that id count `[inferred: the events carry the id]`.
- **Network quiet replaces `networkidle`.** After the story settles, the runner waits until the page
  has had no request in flight for 500 ms, bounded by the settle timeout. This is counted from the
  driver's request events, not from the page.
- **Fonts.** The runner awaits `document.fonts.ready` after every switch. A font loaded by an earlier
  story must not be the reason a later one differs.
- **The fallback stays.** A story that never signals gets `delay ?? 500` ms as today, and then ends
  the session (decision 4).
- The two runners' in-page functions stay identical, as AGENTS.md requires for `settle.ts`.

### 4. Isolation: clean what is known, reload when unsure

After each screenshot, before the next switch, the runner undoes its own changes:

- removes its ignore-region style tag;
- restores the viewport size;
- scrolls to the top, blurs the focused element and moves the pointer to the corner;
- clears web storage, IndexedDB and cookies with the existing `clearBrowserState`.

It then compares a **page fingerprint** with the one taken after the session's first load: the
`class` and `style` of `html` and `body`, the number of `body` children outside Storybook's roots,
and the number of style and link elements in `head`. A different fingerprint ends the session.

A session also ends, and the next story gets a fresh load, when any of these is true:

| Reason                       | Rule                                                                  |
| ---------------------------- | --------------------------------------------------------------------- |
| The story failed             | A render error, a play error, a timeout or the fixed-wait fallback    |
| A play function ran          | `executePlay` is on and the story is tagged `play-fn` `[inferred]`    |
| The story asks for it        | `parameters.storyshelf.isolate: true` reloads before and after it     |
| The story paused things      | `pauseAnimationAtEnd`, or a video was paused by the runner            |
| The fingerprint moved        | As above: a portal, a body class or a leaked style element            |
| The session is long          | After 25 stories (proposal; the gate picks the number)                |
| A retry or a crash bisection | `capture-retry.ts` and `isolate.ts` always use a fresh page, as today |
| Storybook tests              | `runTests` entries keep their own path and never share a session      |

- With `executePlay` on and an index that has no `play-fn` tags, switching is off for that build.
- What this does not catch: timers, listeners on `window`, module-level state and mocked globals.
  Decision 5 exists because of them.
- Args cannot leak between stories here: each story is rendered once per session and no args are
  sent. The runner does not call `updateArgs`.
- Accessibility checks are unchanged: axe runs after the play function and before the screenshot,
  and its results stay informational.

### 5. Only "unchanged" is taken from a switched capture

- A switched capture may end in exactly one result: **unchanged against the baseline**.
- A story with no baseline is never switched. It is captured on a fresh page, as today
  `[inferred: core can pass this to the runner]`.
- A switched capture that differs from its baseline is discarded. Core renders that story again on
  a fresh page, and that second image is the one that is compared, stored and shown.
- Therefore every baseline, every reported change and every image a reviewer sees comes from a
  fresh page. A leak can no longer invent a change.
- What remains is a leak that hides a real change: a switched capture that wrongly matches the
  baseline. The gate (decision 9) is the evidence against it, and `isolate` and the project switch
  are the escape.
- The capture fingerprint (`fingerprint.ts`, `infraHash`) does not include the switch. Reported
  pixels come from the same procedure either way, so turning it on is not an environment change.
- The attempt log records, per build: how many captures were switched, how many were confirmed on a
  fresh page, and each session end with its reason. No snapshot column is added.

### 6. Both runners

- The Playwright and Puppeteer runners implement the same session rules with the same in-page
  functions `[inferred: the Puppeteer files mirror the Playwright ones]`.
- Each runner passes the gate on its own. A runner that has not passed reports that it cannot
  switch (decision 2).

### 7. Remote browsers

- The rules are the same. The gain should be larger, because every navigation crosses the network
  to the app's signed capture route.
- A session never outlives its signed base URL. A re-minted token starts a new session.
- Leases, `maxConnections`, the environment probe and `scrubConnection` are untouched. A session
  lives inside one connection and is closed before the lease is released.
- Remote targets stay off until the local gate has passed and the remote integration suite passes
  with the switch on.

### 8. What does not change

- Baselines per branch, diff thresholds, modes, capture targets and the queue.
- `reusePages`: it still decides whether a page and its HTTP cache survive between sessions.
- Browser recycling every 150 captures, and cancellation.

### 9. The measurement gate

Adoption needs both parts. Either failing means the code does not merge.

**Correctness: zero new diffs.**

- On `fixtures/storybook-8`, `-9` and `-10`, in each runner, every snapshot taken with the switch on
  is byte-identical to the one taken with it off. Not "within threshold".
- That holds over three runs, plus one run in reverse story order and one with a different page
  count, so that different stories precede each other.
- The fixtures gain a small set of deliberately leaking stories: a body class, a portal, a global
  style, a timer that edits the DOM, a late font, web storage and a play function that mutates. Each
  must end its session or still produce the identical image.
- In the gate runs, decision 5's second pass is disabled, so a leak shows as a diff instead of being
  repaired.

**Speed: faster than the #853 baseline.**

- `nub run bench` before and after, same machine, median of three with the warm-up dropped.
- The measured row is a **full capture of an unchanged build**. If the benchmark's second upload
  uses affected capture, it needs a full-capture row first `[inferred: not read in run.mjs]`.
- The capture time of that row must drop by at least 15% (proposal), and no other row may get
  slower beyond the run-to-run spread.
- Both tables go in the PR body, as #876 asks.

## Consequences

- **Where it helps.** Full captures of a mostly unchanged Storybook: no stats file, a global file
  changed, `--full`, or a project that does not use affected capture.
- **Where it does not.** A first build (nothing has a baseline), and builds where affected capture
  already renders only the changed stories.
- **A changed story costs two captures.** That is the price of decision 5. A build that changes
  most stories is slower with the switch on than off.
- **A leak can still hide a change.** The risk is bounded by the gate, the session rules and the
  per-story `isolate`; it is not zero. The docs must say so where the setting is described.
- **More runner code in two copies.** Session grouping, the network-quiet wait, the fingerprint and
  the recorder reset exist in both runners until the in-page scripts move into core (ADR 0001
  amendment).
- **One new project column** and one setting in the capture settings page.
- **Fonts are awaited on every switched capture.** That is a small fixed cost.

## Alternatives considered

- **Switch and trust the result.** What #876 describes and what other tools do. Rejected: a leaked
  style or timer would be reported as a visual change in someone's pull request, and nobody could
  tell it from a real one.
- **`updateGlobals` for modes inside a session.** Rejected for now: globals are URL state today, and
  a theme decorator is the most likely thing to leak. Revisit with numbers.
- **Reload only on failure.** Rejected: most leaks do not fail anything.
- **A fresh browser context per story, same page pool.** That is `reusePages`. It keeps isolation
  but still pays for the document and Storybook's start-up, which is the cost this ADR targets.
- **Include the switch in the capture fingerprint.** Rejected: with decision 5 the reported pixels
  do not depend on it, and it would mark every snapshot as an environment change.
- **Do nothing.** Still the outcome if the gate fails. Affected capture and the #853 to #857 work
  may already cover most of the gain.

## Gate result (2026-11-14)

The gate in decision 9 was run for #990. **Correctness passed; speed failed.** Per decision 9 the
code did not merge (architect decision on #990). It is kept on the branch `feat/990-switch-stories`
(PR #1041, closed), with the gate suite and the bench's `--switch-stories` flag.

- **Correctness.** Both runners, `fixtures/storybook-8`, `-9` and `-10`, the leaking stories
  included, two viewports: every snapshot with the switch on was byte-identical to the fresh one
  over three runs, reverse order, three pages and one page.
- **Speed.** `nub run bench`, same machine, median of three. Full capture of an unchanged build:
  6588 ms off, 6603 ms on, **+0.2%** against the required −15%. Page reuse (#857) already makes a
  fresh load of a small, cached Storybook cheap, and decision 3's 500 ms quiet window dominates each
  switch. Only 12 of 26 captures could switch on that fixture.
- **Next.** #1050 (deferred) re-runs the gate on a large, realistic fixture before decision 3's
  window is revisited. Until then the behaviour in Context is the only one.
