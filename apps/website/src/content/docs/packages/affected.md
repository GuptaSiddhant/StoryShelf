---
title: "@storyshelf/affected"
description: Zero-dependency dependency-graph tracing for affected capture — shared by the server and the CLI.
---

`@storyshelf/affected` computes which stories are impacted by a change: git diff → bundler graph → reverse trace → affected story files. Both `@storyshelf/core` (server partition) and `storyshelf` (CLI computation) consume it, so the two sides always agree. It has **zero runtime dependencies** (Node builtins only) to keep the CI client light.

[![JSR](https://jsr.io/badges/@storyshelf/affected)](https://jsr.io/@storyshelf/affected) [![JSR Score](https://jsr.io/badges/@storyshelf/affected/score)](https://jsr.io/@storyshelf/affected)

- [npm package](https://www.npmjs.com/package/@storyshelf/affected) — install tarballs and version history.
- [JSR package](https://jsr.io/@storyshelf/affected) — TypeScript-first registry page.
- [Public API reference](https://jsr.io/@storyshelf/affected/doc) — generated docs for every export; start here to learn the API.
- [Source on GitHub](https://github.com/GuptaSiddhant/storyshelf/tree/main/packages/affected) — package directory on `main`.

## Install

```sh
nub add @storyshelf/affected
```

## API

```ts
import {
  computeAffected,      // full pipeline: git + index + stats + trace (never throws)
  traceAffected,        // graph + changed files + story files -> affected, or null for full
  selectAffectedStories,// stories + affected paths -> { render, inherit }
  changedFiles,         // git diff baseline..HEAD plus staged/untracked
  gitHeadSha,           // local git HEAD, or null without git
  gitBranchName,        // local git branch, or null without git
  gitRepoStatus,        // "ok" | "shallow" | "no-git"
  localSha,             // synthetic unique sha (LOCAL_SHA_PREFIX) for non-git checkouts
  loadDepGraph,         // preview-stats.json -> bidirectional DepGraph (null when unusable)
  loadStoryImportPaths, // index.json/stories.json -> story import paths
} from "@storyshelf/affected";
```

`computeAffected({ cwd, buildDir, baseSha, headSha, untraced?, statsFile? })` returns `{ affectedImportPaths: string[] | null, changedFiles, baselineSha, fullReason }`. A `null` affected set means "render everything" — the contract is fail-open by design, which is what lets affected capture stay enabled by default.

Accepted stats shapes: Vite `preview-stats.json` module arrays (`id`/`importedIds`), record-shaped module maps, and Webpack-style `reasons` edges. Absolute stats paths match repo-relative changes by suffix.

## Modules

One concern per file: `types` (graph/result shapes), `stats` (parse + index), `graph` edge helpers live in `stats`, `git` (diff, shallow guard, 10k cap), `trace` (glob matcher, global bailouts, BFS), `select` (partition), `index` (composition root).

## When to use it

You don't install it directly — `core` and the CLI already depend on it. Reach for it when building a custom story source (Ladle/Histoire): implement the graph loader for your builder and reuse `traceAffected`/`selectAffectedStories` unchanged. See [Affected capture](../../concepts/affected-capture/).
