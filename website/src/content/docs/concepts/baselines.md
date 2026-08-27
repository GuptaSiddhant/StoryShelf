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
