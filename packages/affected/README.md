# @storyshelf/affected

Affected capture for StoryShelf: traces the dependency graph of a change to select only the stories it impacts.

## Install

```sh
nub add @storyshelf/affected
```

or

```sh
npm install @storyshelf/affected
```

## Usage

```ts
import { computeAffected } from "@storyshelf/affected";

const result = await computeAffected({ cwd, buildDir, baseSha, headSha });
```

See the [StoryShelf documentation](https://github.com/GuptaSiddhant/StoryShelf#readme) for configuration details.

## API

```ts
import {
  computeAffected, // full pipeline: git + index + stats + trace (never throws)
  traceAffected, // graph + changed files + story files -> affected, or null for full
  selectAffectedStories, // stories + affected paths -> { render, inherit }
  changedFiles, // git diff baseline..HEAD plus staged/untracked
  gitHeadSha, // local git HEAD, or null without git
  gitBranchName, // local git branch, or null without git
  gitRepoStatus, // "ok" | "shallow" | "no-git"
  localSha, // synthetic unique sha (LOCAL_SHA_PREFIX) for non-git checkouts
  loadDepGraph, // preview-stats.json -> bidirectional DepGraph (null when unusable)
  loadStoryImportPaths, // index.json/stories.json -> story import paths
} from "@storyshelf/affected";
```

`computeAffected({ cwd, buildDir, baseSha, headSha, untraced?, statsFile? })` returns `{ affectedImportPaths: string[] | null, changedFiles, baselineSha, fullReason }`. A `null` affected set means "render everything" — the contract is fail-open by design, which is what lets affected capture stay enabled by default.

Accepted stats shapes: Vite `preview-stats.json` module arrays (`id`/`importedIds`), record-shaped module maps, and Webpack-style `reasons` edges. Absolute stats paths match repo-relative changes by suffix.

## License

MIT
