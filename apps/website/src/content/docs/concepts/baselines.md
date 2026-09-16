---
title: Baselines & branches
description: How StoryShelf decides what to compare against.
---

For each story and viewport, StoryShelf picks a baseline:

1. The **accepted baseline on the current branch**, if one exists.
2. Otherwise, the **default branch's** baseline.
3. If neither exists, the story is **new**.

## Default branch

Builds on the default branch auto-approve and become the baselines. Pushing to `main` re-baselines the project.

## Accepting changes

Accepting a change on a feature branch records a baseline **for that branch**, so the next commit doesn't re-flag the same change. Merging to `main` promotes the baselines on the next default-branch build.

## Persistent builds

A build carrying the `persistent` label is never purged. The CLI attaches it automatically for commits with git tags, so release builds survive retention.

## Branch GC

Feature-branch baselines are GC'd after `branchTtlDays` (default 30, `null` = disabled) of inactivity via a daily sweep (`branchGcIntervalMs` 24h). Default-branch baselines are never GC'd.

## When to promote manually

Most teams never promote manually — pushing an accepted feature branch to `main` auto-promotes on the next default-branch build. If you need to pin a branch as a long-lived baseline (e.g., `release/2.0`), set that branch as the default in project settings or copy its baselines via the API.

## Debugging baseline selection

On the build detail page each snapshot shows `Baseline: <branch>@<buildId>` or `New` when no baseline exists. If a story is unexpectedly `New` on a PR, check: (1) no accepted baseline exists on the PR branch yet (accept once), and (2) the default branch has a baseline for that story/viewport — otherwise the PR correctly has no ancestor.

## Retention vs. baselines

Builds are transient and purged by `purgeTtlDays` (default 30); baselines outlive their builds and are stored separately. Purging a build does not delete its baseline — the next build on that branch still compares against it until `branchTtlDays` GC.
