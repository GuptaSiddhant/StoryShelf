# Overview

> Part of the [StoryShelf architecture spec](./README.md).

## What StoryShelf Is

A self-hosted visual testing platform for Storybook. Run visual regression tests in CI, review pixel-level diffs in a web UI, and approve changes before they ship. No per-snapshot billing. No vendor lock-in.

**One-liner:** "Self-hosted Chromatic alternative. Storybook-native. Unlimited snapshots."

## Product Workflow

```
Developer pushes code
  → CI runs: npx storyshelf upload --token=xxx
  → CLI builds Storybook only when the build directory is missing (or with --force-build), then streams the directory as a zip (file by file when the server's inline limit refuses the zip)
  → CLI uploads the zip + metadata (git sha, branch, message, author, labels, affected-only) to StoryShelf server
  → Server creates a build, stores the zip, and enqueues capture (async, returns 202)
  → The server's job consumer: unzip → serve statics → render every story via Playwright
  → Server runs pixel diff against per-branch baselines (fallback to default branch)
  → Default-branch builds auto-approve and become the new baselines
  → PR gets a status check linking to the review UI
  → Reviewer opens review page, sees diff overlays
  → Reviewer accepts/rejects changed stories
  → Accepted stories become that branch's baselines
  → PR can merge; the next default-branch build re-baselines everything
```
