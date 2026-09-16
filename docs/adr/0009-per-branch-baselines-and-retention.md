# ADR 0009: Per-Branch Baselines with Fallback + Retention & Purge

## Status

Accepted

## Context

Visual testing hinges on one question: **which screenshot do we compare against?** Two models were considered:

1. **Always diff against the default branch.** Simple, but every commit to a feature branch re-flags stories that were already accepted against an untouched default branch. Multi-commit PRs force reviewers to re-approve the same change repeatedly.

2. **Per-branch baselines with fallback to default (Chromatic's model).** Accepting a change on a branch records a baseline *for that branch*; subsequent builds on that branch diff against the accepted version. Stories never accepted on a branch fall back to the default branch.

A second, orthogonal concern is **retention**: because the server stores every screenshot and never clones a repo from which to re-derive them, screenshots accumulate indefinitely. Baselines are the durable truth; everything else is transient.

## Decision

### 1. Per-branch baselines with fallback

The `baselines` table is keyed by `(project, story, viewport, branch)`. The canonical baseline is its **file** (`screenshot_path`), stored independent of any build so it survives purge.

For a snapshot of `(story, viewport)` on branch `B`:

1. Use `baselines(project, story, viewport, branch=B)` if present.
2. Else fall back to `baselines(project, story, viewport, branch=default)`.
3. If neither exists (brand-new story):
   - **default branch** → auto-approve, write the baseline.
   - **feature branch** → mark `new` (needs review).

**Accept** copies the accepted snapshot's screenshot to `baselines/{branch}/{story}/{viewport}.png` and upserts the row for that branch. **Reject** marks the snapshot rejected and writes nothing.

**Merge** needs no explicit promotion step: the next default-branch build re-captures everything and auto-approves, re-baselining the project.

### 2. Retention & purge

**Never purged:** default-branch `baselines/**` files/rows and builds bearing a `persistent` label (see ADR 0013). Feature-branch baselines are purged via branch GC below.

**Purged:**
- Builds in a terminal review state (`approved`/`rejected`) older than `purge_ttl` (default 30 days).
- Old builds of a branch: retain the most recent build per branch (it backs the PR status link); purge older ones past TTL.
- Builds in non-terminal states are never purged (a `reviewing` build must not vanish before review).
- **Stale branch baselines:** branches whose latest build is older than `branchTtlDays` (default 30, `null` = disabled) are GC'd — deletes `baselines/{branch}/**` files and `baselines` rows for that branch (default branch never GC'd).

Purge deletes storage files (`builds/{buildId}/` or `baselines/{branch}/**`) and database rows (`builds`, `snapshots`, or `baselines`) together.

### 3. Orphaned baselines

A story renamed or removed from Storybook leaves a stale baseline. On each default-branch build, diff `index.json` against `baselines` and delete baselines whose `story_id` no longer exists (now also deletes the storage file).

### 4. Trigger

- **Scheduled**: in-server timers — build purge (`--purge-interval`, default hourly) and branch GC (`branchTtlDays` 30 + `branchGcIntervalMs` 24h daily interval clock via `retention-timer.ts`, staggered 1h).
- **Manual**: `storyshelf purge` CLI command or `POST /api/v1/admin/purge` (now runs both build purge and branch GC; returns `{removedBuilds,removedBranches,removedBaselines}`).

## Consequences

**Positive:**
- No re-review of already-accepted changes on multi-commit PRs
- Baselines survive build purging (canonical file, not a pointer into a transient build)
- Disk usage is bounded by TTL + per-branch retention
- Merge-to-default is implicit (next default build re-baselines)

**Negative:**
- Feature-branch baselines can diverge from default; a `git pull` after main moves under a story re-flags it (correct, but surprising the first time)
- "Auto-approve default" means a regression pushed straight to default is baselined silently — an accepted consequence of the model, with a future "require approval on default changes" escape hatch if needed

**Branch churn bounded:** stale feature branches are GC'd after `branchTtlDays` (30d default, daily sweep via `Retention.purgeStaleBranches` + `retention-timer.ts`); default branch is never GC'd.
