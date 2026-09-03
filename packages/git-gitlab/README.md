# @storyshelf/git-gitlab

GitLab commit-status adapter for StoryShelf: posts commit status checks, detects merges, and upserts MR comments via the GitLab API.

## Install

```sh
nub add @storyshelf/git-gitlab
```

or

```sh
npm install @storyshelf/git-gitlab
```

## Quick start

```ts
import { gitLabHost } from "@storyshelf/git-gitlab";
import { createShelfRouter } from "@storyshelf/core";

const app = createShelfRouter({
  database, storage,
  // ...adapters...
  gitHosts: [gitLabHost],
});
```

`gitLabHost` is a `GitHostProvider` (from `@storyshelf/core`). At capture time the router registers per-project status configs and calls `host.create({ config, token })` to get a configured `GitHostAdapter` bound to that project's `owner`/`repo` and decrypted token.

## API

### `gitLabHost: GitHostProvider`

A singleton `GitHostProvider` with `metadata` (`name: "GitLab"`, `kind: "gitlab"`) and a `create({ config, token, logger? })` method that returns a `GitHostAdapter` backed by the GitLab API.

The project config is validated against `gitlabConfigSchema`:

```ts
interface GitLabProjectConfig {
  owner: string;   // GitLab owner (user or group)
  repo: string;    // repository / project name
  host?: string;   // optional self-hosted GitLab base URL (defaults to gitlab.com)
}
```

The returned `GitHostAdapter` implements:

- `setStatus({ context, gitSha, status, url })` — post a commit status check.
- `isMerged({ sha, branch })` — whether the commit is already merged (used to skip capture on the merge gate).
- `upsertComment({ prNumber?, sha, url, status, markdown })` — create or update a single MR note per build (idempotent via a `url` marker).

## How it fits in

`git-gitlab` is the `gitHosts` adapter for GitLab-hosted repositories — the mirror of `@storyshelf/git-github` for GitHub. It implements the same `GitHostProvider`/`GitHostAdapter` interface, so switching hosts is just swapping the provider in the `gitHosts` array.

See `docs/architecture.md` and ADR 0010.

## Development

```sh
nub run build     # bundle with tsdown
nub run fmt       # format with oxfmt
nub run lint      # type-aware lint with oxlint
nub run test      # vitest suite
```
