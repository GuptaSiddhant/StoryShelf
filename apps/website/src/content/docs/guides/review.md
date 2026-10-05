---
title: Review workflow
description: Approve, reject, comment, and retry — the build review flow that gates merges.
---

Every build lands in `reviewing` once diffing finishes (default-branch builds auto-approve). Review is per-snapshot; the build gate is the merge gate.

![Diff review — snapshot navigator, baseline | current | diff viewer, and comment thread](/screenshots/diff-review.png)

The review bar stays pinned while scrolling, with the snapshot title, status, and Approve/Reject actions. The `Split | Baseline | Current | Diff` switcher focuses a single pane for large screenshots; keyboard shortcuts (`←`/`→` navigate, `a` approve, `r` reject) work throughout.

## Approve / reject

- **One snapshot:** `POST /api/v1/projects/:slug/builds/:id/snapshots/:snapshotId/approve` (or `/reject`). Approving copies that snapshot’s PNG to `baselines/{branch}/{storyId}/{viewport}.png` — the branch’s new expected.
- **Bulk:** `POST …/builds/:id/approve-all` / `reject-all`.

The build status flips to `approved` when every `new`/`changed` snapshot is resolved, `rejected` if any is rejected, stays `reviewing` while unresolved. Snapshot statuses: `new` (no baseline), `changed` (threshold exceeded), `unchanged` (within), `approved`/`rejected`/`pending`.

## Comments

Threaded review comments live on a build or a single snapshot, with **resolve**:

- `GET /api/v1/projects/:slug/builds/:id/comments`
- `POST …/comments { body, snapshotId?, parentId? }`
- `POST …/comments/:commentId/resolve`

Comments persist until the build is purged (see [Retention](/concepts/retention/)). The UI’s diff overlay (baseline | current | diff) is the heat map — red = changed pixels, thresholds from `pixel_threshold` / `max_diff_ratio` or per-story `diffThreshold`.

## Retry & merge gate

- **Flaky capture:** **Retry** on the build page re-enqueues the same build ID (`POST …/builds/:id/retry`) — see [Interaction testing](/guides/interaction-testing/) for `flakyTest` handling.
- **Merge gate:** each project posts `storyshelf/<slug>` commit status via the git-host adapter (`@storyshelf/git-github` / `@storyshelf/git-gitlab`). Branch protection marks it **required** — `pending` while capturing, `success` when `approved`, `failure` when `rejected` or remained unresolved. A future GitHub App will add per-snapshot check-run annotations (ADR 0010).

## Related

- [Builds & snapshots](/concepts/builds/) — statuses & attempts
- [Baselines & branches](/concepts/baselines/) — which baseline is expected
- [CI setup](/guides/ci/) — required status check
- [API reference](/guides/api/) — endpoint walkthrough
