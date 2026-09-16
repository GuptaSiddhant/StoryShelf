# ADR 0017: Interaction Testing via Storybook `play` Function

## Status

Accepted

## Context

Storybook stories can carry a `play` function — `play: async ({canvasElement}) => { await userEvent.click(...); await expect(...).toBeVisible() }` — to exercise interactions and assert behaviour. Chromatic optionally runs `play` before snapshotting. StoryShelf's capture pipeline today (`packages/runner-playwright/src/capture-runner.ts:130`) does `goto(iframe.html) → waitForSelector(#storybook-root) → waitForTimeout(500) → screenshot()` with **no** `play` execution. Deferred per ADR 0004/src/architecture.md:838 (`parameters.chromatic` equivalents) and docs/adr/0005.

Users asked for StoryShelf to **be the CI gate** for interaction tests so they can drop separate `storybook test`/`vitest` runs. Requirements consolidated over design iterations:

1. `play` failure must **block** the build (`failed`) — no reviewer waive in the build review UI.
2. A *flaky* story must **not** block — `tags: ['flaky-test']` (case-insensitive, whole-story) or `parameters.flakyTest: true` (both `chromatic` and `storyshelf` keys, `storyshelf` wins) marks the whole story non-blocking; failures show warnings + GitHub success-with-warning comment.
3. `disableSnapshot: true` (same dual-key) *just disables* — skip capture + play, not counted, no `failed`.
4. `storeStoriesJson`/`buildStoriesJson` must not require `.storybook/main.ts` edits — CLI should inject `STORYBOOK_BUILD_STORIES_JSON=true` when it builds.
5. Interaction testing is **opt-in per project** — a project setting feature flag, default `false` (existing 500ms behaviour preserved).

## Decision

### 1. Opt-in project feature flag

Add `projects.execute_play boolean DEFAULT 0` and `play_timeout_ms integer DEFAULT 10000`.

- `executePlay === false` (default): runner ignores `play`, keeps `waitForTimeout(500)` + `networkidle`.
- `executePlay === true`: runner executes `play` for each story before screenshot.

Exposed in the project settings UI as a new **Tests** tab (`GET/POST /projects/:slug/settings/tests`, `pages/settings-tests.tsx`), gated by `isAdmin`, between *General* and *Labels*. Shows:
- checkbox *Enable interaction tests (play)* (default off, hint explains blocking behaviour)
- number *Play timeout (ms)* (1000-30000, default 10000)
- read-only doc block for `flaky-test` tag and `flakyTest`/`disableSnapshot` via `parameters`.

Project-scoped; global `ShelfConfig.viewports` stays the default for viewports.

### 2. Dual-key parameters + tags

`StoryEntry.parameters?: StoryParameters` where `StoryParameters {disableSnapshot?, delay?, diffThreshold?, pauseAnimationAtEnd?, flakyTest?}`.

`StorybookAdapter.discover()` merges file-based parameters (`stories.json` preferred, fallback `index.json` + runtime `page.evaluate(() => __STORYBOOK_PREVIEW__.extract()[id].parameters)` for SB 8 without `buildStoriesJson`) as `{...chromatic, ...storyshelf}`. Existing Chromatic repos work unchanged.

Flaky detection: `isFlaky = tags?.some(t => t.toLowerCase() === 'flaky-test') || merged?.flakyTest === true`. Whole-story, case-insensitive, no custom tag name (single `flaky-test`).

`orchestrator` filters `disableSnapshot` *before* render; `flaky` stories are still rendered.

### 3. `storeStoriesJson` injection

`packages/cli/src/commands/upload.ts:ensureBuildDir()` sets `env.STORYBOOK_BUILD_STORIES_JSON='true'` when `execSync`-ing the build command. No codemod of `.storybook/main.ts`, no `package.json` script change. If the user builds outside `upload` (manual `storybook build -o ...` then `upload` without rebuild), the runner's runtime fallback covers it.

### 4. Failure handling

`CaptureRunner` returns `failures` per `story×viewport`; `orchestrator` partitions into `blocking` vs `flaky` by story-level `isFlaky`; `pipeline.finalize()` sets:

```
hasBlocking = blockingIds.size > 0
status = hasBlocking ? 'failed' : (changedCount===0 ? 'approved' : 'reviewing')
```

Flaky failures keep `testStatus='failed'` but `status` stays `reviewing/approved`; UI shows warning badge/banner, Git hosts post `success` with warning comment `⚠️ flaky story failed — not blocking`.

### 5. No reviewer waive

Per review, UI waive is not a good use of resources — flaky should be marked `flaky-test`/`flakyTest` in code. Build review stays `Approve/Reject` only; flaky failures are informational.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| Full `parameters.chromatic` passthrough (modes/themes/viewports per story) | Scope creep; per-story viewports already deferred, global `viewports` suffices for v1 |
| Custom `flaky` tag name per project | Unneeded complexity; single `flaky-test` (case-insensitive) covers both `chromatic` and `storyshelf` users |
| Per-viewport flaky (one viewport flaky, one blocking) | Tags are story-level; viewport-level would require `parameters` per viewport, deferred |
| Host externally-generated JUnit/coverage reports | Orthogonal report-hub feature; interaction testing is the higher-leverage complement to visual diff |
| Execute `play` unconditionally (no opt-in) | Would break existing builds that have `play` for dev-only interaction tests not intended to block |
| Keep `play` out of the visual diff baseline (separate test report table) | Adds new table + retention; visual diff after `play` is the desired baseline for most teams |
| Derive `parameters` only from `index.json` | SB 8 `index.json` omits `parameters`; would silently ignore `disableSnapshot`/`flakyTest` |

## Consequences

**Positive:**
- One gate for visual + interaction: users can drop separate `storybook test` CI.
- Migration is zero-touch for Chromatic users (`chromatic` key still works) and for new users (`storyshelf` key).
- Opt-in preserves existing `500ms` behaviour; no file patches.

**Negative:**
- One extra project migration (`execute_play`, `play_timeout_ms`) needed for `db-sqlite`/`db-turso`.
- Runtime `page.evaluate` fallback adds ~1 evaluate per story when `stories.json` missing — negligible but extra browser round-trip.
- Flaky stories still charge capture time + storage (unlike `disableSnapshot`).

## Links

- `packages/core/src/capture/adapter.ts` — `StoryEntry`/`StoryParameters`
- `packages/core/src/capture/storybook.ts` — file + runtime parameter merge
- `packages/cli/src/commands/upload.ts` — `STORYBOOK_BUILD_STORIES_JSON` env
- `packages/runner-playwright/src/capture-runner.ts` — `executePlay` branch
- `packages/core/src/capture/orchestrator.ts` / `pipeline.ts` — blocking vs flaky partition
- `packages/core/src/pages/settings-tests.tsx` — Tests tab
