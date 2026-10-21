# ADR 0028: Modes and Multi-Browser Capture (named modes, per-engine baselines, shared approval)

## Status

Accepted

Amended in part by ADR 0033 (engine identity becomes a capture target, `<engine>@<name>` for remote browsers).

## Context

Capture was `story × viewport` on one `project.browser`. Theme/locale globals could not be tested, and covering Firefox or WebKit meant switching the project's only browser (baselines "tracked" it through `infraHash` only). Chromatic solves both with **Modes** (named, with their own baseline and approval) and per-browser snapshots. Issue #128 shipped in four PRs (#143, #144, #146 and the review/settings PR).

## Decision

1. **Modes are named and come from story parameters**, Chromatic-compatible: `parameters.chromatic.modes` and `parameters.storyshelf.modes`, at project, component or story level, merged per mode name (`storyshelf` wins). A mode is `{ viewport?, disable?, ...globals }`. `disable: true` drops an inherited mode (or a project viewport of the same name). `globalTypes` is **not** scanned: this replaces the issue's canonical-query `mode_key` and auto-discovery, because Chromatic keys a baseline by the mode *name*, so changing what a mode does keeps comparing against the same baseline.
2. **Identity.** A mode's baseline key is the slug of its name (`modeSlug`). It is stored in the existing `viewport_name` column, so legacy viewport rows and storage paths stay valid; a mode named like a project viewport replaces it. `mode` (JSON of the applied globals) is display/capture metadata only.
3. **Globals reach Storybook through the `globals=` URL argument** (`a:b;c.d:e`, nested objects flattened, `!true`/`!hex()` forms). `viewport` sizes the page and is not forwarded as a global. Verified on Storybook 8, 9 and 10 (Chromium and Firefox, fixtures `Themed` stories): declared globals apply, undeclared ones are ignored, strings pass through, `!hex()` works.
4. **Parameters are read from the running preview.** `index.json` rarely carries parameters, so `CaptureRunner.extractParameters` (optional) loads the preview once and returns resolved parameters before the capture matrix is built. A runner without it (Puppeteer) only sees index parameters.
5. **Guards.** At most 8 captures per story (viewports + default viewport + modes) and at most 3 browsers. Parameter-defined modes cannot be validated at config time, so the cap also runs after extraction and fails the build before rendering. `modesAllowlist` filters declared modes.
6. **Multi-browser.** `projects.browsers` (JSON, primary first) falls back to `browser`. The orchestrator loops engines sequentially over one extraction (`capture/matrix.ts`); runners stay single-engine. Snapshots, baselines, diffs and storage paths are keyed by engine (`<mode>~<browser>` for non-chromium; chromium keeps the legacy layout). `browser` stays in each snapshot's `infraHash`.
7. **New engines bootstrap, they are not copied.** An engine with no baselines yet auto-accepts a story/mode's first snapshot when the primary engine's snapshot of it is clean; otherwise it goes to review as `new`. Chromium images are never copied across engines (rendering differences would diff everything).
8. **Shared approval.** One decision covers a story/mode on every engine (`POST …/stories/:storyId/modes/:modeKey/approve|reject`). It is atomic on drift: if any engine's baseline moved, nothing is approved unless `force`. `approve-all` skips a whole group when one member drifted. Per-snapshot approve/reject remain as the escape hatch ("Only <browser>"). Review progress, filmstrip entries and prev/next count story/mode groups, not browser rows. This deliberately differs from Chromatic, which reviews browsers separately.
9. **Upgrade path.** `browser`/`mode` columns are added in place (all dialects); existing rows fall back to `chromium`, and the viewport-only unique indexes are swapped for browser-aware ones. A project that was captured with Firefox/WebKit before this change therefore starts that engine from fresh baselines.

## Alternatives considered

| Option | Why not |
|---|---|
| Canonical query string as mode identity | Any value change creates a new baseline; diverges from Chromatic |
| Copy chromium baselines to a new engine | Font/anti-aliasing differences make every story diff |
| Parallel engines | Memory multiplies per engine; sequential keeps one browser alive at a time |
| Separate approval per engine | Review load scales with engines; theme/token bumps become unreviewable |

## Consequences

- Reviewers decide per story/mode, with browser tabs for engine-specific inspection.
- Puppeteer supports only Chromium and only index-declared modes.
- A failure on any engine still fails the build for that story (failures are keyed per story).
- Stale `(story, mode, engine)` baselines of a removed mode are not pruned yet.
