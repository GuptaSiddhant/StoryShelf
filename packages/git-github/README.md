# @storyshelf/git-github

GitHub commit-status adapter for StoryShelf: posts commit status checks, detects merges, and upserts PR comments via the GitHub REST API.

## Install

```sh
nub add @storyshelf/git-github
```

or

```sh
npm install @storyshelf/git-github
```

## Quick start

```ts
import { gitHubHost } from "@storyshelf/git-github";
import { createShelfRouter } from "@storyshelf/core";

const app = createShelfRouter({
  database, storage,
  // ...adapters...
  gitHosts: [gitHubHost],
});
```

`gitHubHost` is a `GitHostProvider` (from `@storyshelf/core`). At capture time the router registers per-project status configs and calls `host.create({ config, token })` to get a configured `GitHostAdapter` bound to that project's `owner`/`repo` and decrypted token.

## API

### `gitHubHost: GitHostProvider`

A singleton `GitHostProvider` with `metadata` (`name: "GitHub"`, `kind: "github"`) and a `create({ config, token, logger? })` method that returns a `GitHostAdapter` backed by the GitHub REST API (`@octokit/rest`).

The project config is validated against `githubConfigSchema`:

```ts
interface GitHubProjectConfig {
  owner: string;   // GitHub owner (user or org)
  repo: string;    // repository name
}
```

The returned `GitHostAdapter` implements:

- `setStatus({ context, gitSha, status, url })` — post a commit status check.
- `isMerged({ sha, branch })` — whether the commit is already merged (used to skip capture on the merge gate).
- `upsertComment({ prNumber?, sha, url, status, markdown })` — create or update a single PR comment per build (idempotent via a `url` marker).

## How it fits in

`git-github` is the `gitHosts` adapter for GitHub-hosted repositories — the mirror of `@storyshelf/git-gitlab` for GitLab. It implements the same `GitHostProvider`/`GitHostAdapter` interface, so switching hosts is just swapping the provider in the `gitHosts` array.

See `docs/architecture.md` and ADR 0010.

## Development

```sh
nub run build     # bundle with tsdown
nub run fmt       # format with oxfmt
nub run lint      # type-aware lint with oxlint
nub run test      # vitest suite
```
