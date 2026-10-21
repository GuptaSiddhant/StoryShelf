# Plan: Handling baseline changes between diff and approval

Status: implemented (data model, guard, re-diff, UI, docs).
Scope: `@storyshelf/core`, `@storyshelf/app`, `db-sqlite`, `db-postgres`, `db-mysql`.

Implementation notes (deviations from the design below)
- Approval is check-then-write, not an atomic compare-and-set: `DatabaseAdapter.update` is by id only,
  so two truly simultaneous approvals can still both pass the check. The window is small (the check
  runs right before the baseline write), and the loser of a sequential race gets the 409.
- Recapture stays manual by design. Nothing re-renders or re-diffs on a baseline change; the reviewer
  triggers `POST .../builds/:id/rediff` (stored screenshots only) or Retry capture (re-render).
- `baseline_version` uses the sentinel `"none"` for "no baseline at diff time" so legacy rows (NULL)
  stay distinguishable from new stories.
- Re-diff refuses default-branch builds (400) and builds that are not `reviewing`/`approved`/`rejected` (409).
- UI: a warning notice on the review and build pages (manual-recapture message, Re-diff and Retry capture
  actions) and, per snapshot, "Approve anyway" in place of Approve (no keyboard shortcut for the forced path).
- Known gap: re-diff calls `refreshBuild`, which re-emits `build:<status>` webhooks/notifications even
  when the status did not change.

## Problem

A snapshot's diff is computed against the baseline that existed at capture time, but nothing records
which baseline that was. Approval later copies the snapshot's screenshot over the branch baseline
unconditionally (`approveSnapshot`, `packages/app/src/routers/builds.handlers.ts`). Consequences:

1. **Stale diff on feature branches.** A feature build with no baseline of its own diffs against the
   default branch's baseline. If the default branch re-baselines afterwards (now automatic, see the
   default-branch auto-approval change), the diff is out of date. Approving it writes the feature's
   older-looking screenshot as that branch's own baseline, which stops the fallback to the newer default
   baseline and can silently revert the default branch's visual change.
2. **Concurrent approvals.** Two builds on the same branch can both approve the same story; the last
   write wins with no warning.
3. **Inherited snapshots** (affected-only capture) copy the baseline at capture time; the build keeps
   showing that state after the baseline moves.

There is no recapture or re-diff trigger on baseline change. Only the manual "Retry capture" or a new
upload re-diffs.

## Goals / non-goals

Goals
- Make staleness detectable: a snapshot knows which baseline it was diffed against.
- Never overwrite a baseline the reviewer did not see, without an explicit decision.
- Let a reviewer re-diff a build against current baselines without re-rendering.

Non-goals
- Automatic recapture of open builds when a baseline changes (cost grows with open PRs x merges).
- Changing default-branch semantics (auto-approve + re-baseline stays).
- Rebasing/merging screenshots (no three-way merge).

## Design

### 1. Record the baseline on the snapshot (data model)
Add to `snapshots`:
- `baseline_id TEXT NULL` - the baseline row used for the diff (NULL for new stories).
- `baseline_version TEXT NULL` - that baseline's `updated_at` (or its `snapshot_id`) at diff time.
  Needed because baseline rows are updated in place by `BaselineModel.upsert`, so the id alone
  does not change.

Write both in `createWithBaseline` and in the inherited-snapshot path (`packages/core/src/capture/pipeline.ts`).
For the fallback case (feature branch using the default baseline) the id refers to the default
branch's baseline row, which is exactly what we need to detect drift.

Schema work, following the repo's layout:
- `packages/core/src/schema/snapshot.ts` (type), `models/snapshot.ts` (create/update mapping).
- DDL + schema in each of `db-sqlite` (`ddl.ts`, `schema/snapshot.ts`, `ensureColumns` handles upgrades),
  `db-postgres` and `db-mysql` (`ddl.ts`, `schema/snapshot.ts`, plus an `ALTER TABLE ... ADD COLUMN IF NOT
  EXISTS` constant in `migrate.ts`, same pattern as `SNAPSHOT_INFRA_HASH_ALTER`).
- Existing rows have NULLs; treat NULL as "unknown, not stale" so old builds keep working.

### 2. Staleness check
New pure helper in core, e.g. `baselineStatus(snapshot, currentBaseline)` returning
`"current" | "stale" | "unknown" | "removed"`:
- `unknown` if `baseline_version` is NULL (legacy rows, new stories with no baseline when captured).
- `removed` if the recorded baseline no longer exists (branch purged).
- `stale` if the resolved baseline (same fallback rules as capture: own branch, else default) has a
  different id or `updated_at`.
- A new story that has since gained a baseline is also `stale`.

Resolve the current baseline with the existing `BaselineModel` resolution (own branch, fall back to
default). No new query shape.

### 3. Guard approval
In `approveSnapshot` and the bulk approve route (`snapshots.ts`, `approveAllRoute`):
- Compute `baselineStatus`; if `stale` or `removed`, refuse by default with `409` and a structured
  body (`{ code: "baseline_changed", snapshotId }`).
- Accept `?force=true` / a `force` field for an explicit override, recorded on the snapshot review
  (`reviewedBy` stays; add an audit log line).
- Make the baseline write a compare-and-set against the recorded `baseline_version`, so two concurrent
  approvals cannot both succeed (second gets 409). `BaselineModel.upsert` gets an optional
  `expectedVersion`.
- Bulk approve: approve the non-stale snapshots, return the list of skipped stale ids; do not fail the
  whole request.
- Reject is unaffected (it does not touch baselines).

### 4. Re-diff action (no re-render)
New operation `rediffBuild(buildId)` in core capture code:
- For each snapshot of the build that is `changed`/`new`/`unchanged` (not `approved`/`rejected`), reload the
  stored screenshot, resolve the current baseline, run `diffImages`, and rewrite diff path/ratio, status,
  and `baseline_id`/`baseline_version`.
- Reuse the diff code in `pipeline.ts` (extract the diff-and-record step from `createWithBaseline` into a
  function both paths call; do not duplicate it).
- Then `refreshBuild` to recompute counts and build status. A stale snapshot that now matches the new
  baseline becomes `unchanged` and drops out of the review list.
- Expose as `POST /api/v1/projects/:slug/builds/:id/rediff` (approver role), plus a button on the build
  and review pages. Reuse the existing "Retry capture" button area.
- Snapshots whose screenshot files were purged are skipped and reported.

### 5. UI
- Review page: per-snapshot banner "Baseline changed since this diff was computed" with actions
  "Re-diff" (build level) and "Approve anyway" (force).
- Build page and list: a `stale` badge/count when any open snapshot is stale.
- Banner only for open (`new`/`changed`) snapshots; approved/rejected ones are history.
- Use the existing facade components (`Alert`, `Badge`, `Button`); no inline styles or raw classes.
- Approve/reject responses: fix the raw `{"ok":true}` navigation seen when clicking Approve (the review
  form should use HTMX or redirect back), since this flow adds more conflict responses.

### 6. Optional: mark builds stale after default-branch re-baseline
After a default-branch build re-baselines stories, find open (`reviewing`) builds on other branches that
contain `changed`/`new` snapshots for those stories and mark them for the stale banner. This is a
derived view, not a state change: compute staleness lazily on page load using step 2 rather than
storing it. Only add notification (webhook `build:stale`) if requested.

## Phases

1. **Foundation** (S): columns, models, DDL/migrations for all three DB packages, write the baseline
   fields at capture. Tests: model tests, pipeline tests (own-branch baseline, fallback baseline, no
   baseline, inherited), migration tests per DB package.
2. **Staleness + guard** (M): `baselineStatus`, 409 on approve, compare-and-set upsert, bulk-approve
   skipping. Tests: unit tests for every status, router tests for approve/force/concurrent approve.
3. **Re-diff** (M): extract diff step, `rediffBuild`, route + OpenAPI schema, tests (stale becomes
   unchanged, purged screenshot skipped, build status recomputed).
4. **UI** (S): banners, badge, buttons, review-page flow, consistency-test ratchet stays green.
5. **Docs** (S): update `architecture.md` (entity model + review workflow section), website docs, and
   add an ADR if the 409/force contract is kept.

Dependencies: 1 before everything; 2 and 3 can run in parallel after 1; 4 after 2 and 3.

## Risks and open questions

- **Which version key?** `updated_at` of the baseline vs its `snapshot_id`. `snapshot_id` is stable and
  cheap, but automigrate/`upsert` with the same snapshot would not bump it. Recommend `updated_at`
  (always changes on write).
- **Fallback semantics.** After a feature branch gets its own baseline, later default-branch changes no
  longer affect it. That is by design, but stories where the feature never touched the screenshot will
  still diverge from `main`. Out of scope here; consider a "rebase baselines" action later.
- **Force approve audit.** Do we need a persisted override flag, or is a log line enough?
- **Default-branch builds** never go through approve, so they skip the guard. A default-branch
  re-baseline therefore always wins, which matches `architecture.md`.
- **Cost of re-diff.** One storage read of two PNGs per snapshot; fine for hundreds, may need batching
  or a background job for thousands. Start synchronous with a cap and revisit.
- **Legacy data.** NULL baseline fields mean "unknown"; old open builds will not show stale banners until
  re-diffed once.

## Test plan summary

- core: `baselineStatus` table tests, pipeline writes baseline fields in all four paths, `rediffBuild`.
- app: approve returns 409 on stale, succeeds with force, concurrent approvals (one wins), bulk approve
  returns skipped ids, re-diff route, review/build page banners.
- db packages: new column present after `setup()` on a fresh DB and on a pre-existing DB (upgrade).
- Full verify before merge: `nubx turbo verify --force`.
