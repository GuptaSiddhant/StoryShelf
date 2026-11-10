# Retention

> Part of the [StoryShelf architecture spec](./README.md).

## Retention & Purge

Screenshots accumulate fast. Everything below the **baseline** is transient; the baseline is the truth.

### What is never purged

- Default-branch `baselines/**` files/rows (feature branches TTL'd — see below) and builds bearing a `persistent` label (release/tag builds) and their storage files

### What is purged

- **Builds in a terminal state** (`approved`/`rejected`/`failed`/`cancelled`) older than `purgeTtlDays` (no default: the daily purge is opt-in; a manual purge without `ttlDays` uses `purgeTtlDays` when it is set, else 30).
- **Old builds of a branch**: retain the most recent build per branch (it is the branch's "current" state and powers the PR status link); purge older ones past TTL.
- Builds stuck in `capturing`/`comparing`/`reviewing` are **not** purged (a `reviewing` build must not vanish before review).
- **`pending` builds** (waiting for a review verdict, ADR 0013 decision 9; `core/src/retention/pending.ts`): purged once their last activity (the build's `updated_at`, its newest comment, its newest `build_reviews` row) is older than `purgeTtlDays`. A pending build replaced by a newer one on its branch with no attempts, comments or verdicts is "superseded" and leaves at the same window; the latest-per-branch rule does not shield pending builds, and persistent ones are kept. No new status.
- **Stale branch baselines:** branches whose latest build is older than `branchTtlDays` (default 30, `null` = disabled) are GC'd — deletes `baselines/{branch}/**` files and `baselines` rows for that branch (default branch never GC'd).

Purge removes **both** storage files (`builds/{buildId}/` or `baselines/{branch}/**`) and database rows (`builds`, `snapshots`, or `baselines`) in one transaction.

### Orphaned baselines

When a story is renamed or removed from Storybook, its baseline is never touched by normal builds. On each **default-branch** build, diff `index.json` against the `baselines` table and delete baselines whose `story_id` no longer exists (now also deletes the storage file).

### Trigger

- **Scheduled**: one in-server timer (`retention-timer.ts`, `branchGcIntervalMs` 24h interval clock, staggered 1h) runs branch GC (`branchTtlDays`, default 30) and, **only when `purgeTtlDays` is set explicitly** (no default, so an upgrade never starts deleting builds), the build purge with keep-latest-per-branch. The scheduled build purge runs only the `buildReferenceLifecycle` path (builds, released content, content GC) and does nothing without it, with one warning. Hosts map the setting: `apps/fly-app` and `apps/dev-server` read `PURGE_TTL_DAYS`; core reads no environment variable.
- **With `testing` enabled**, build purge and branch GC run only on a database with the `buildReferenceLifecycle` capability (ADR 0039): SQLite on a file and the Postgres postgres.js, `pg` and `./neon` presets (a pool, not a single injected `Client` or `PoolClient`), all prepared at boot. Without it (Postgres on `./neon-http`, PGlite or a single injected connection, MySQL until #376, or SQLite with retention paused by a baseline whose source build cannot be pinned, shown on the System page), branch GC is skipped (`retention-timer.ts`) and `POST /api/v1/admin/purge` answers `503` (`routers/admin.ts`); builds are retained. Hosting-only deployments are unaffected.
- **Manual**: `storyshelf purge` CLI command or `POST /api/v1/admin/purge` (admin; runs both build purge and branch GC and returns `{removedBuilds,removedBranches,removedBaselines}`, plus `protected` (builds a baseline or investigation still pins) and `resumed` (builds an earlier unfinished run had claimed) when the database has the capability).
