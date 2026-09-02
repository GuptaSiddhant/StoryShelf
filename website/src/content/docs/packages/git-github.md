---
title: "@storyshelf/git-github"
description: GitHub commit-status provider for StoryShelf's visual-testing merge gate.
---

`@storyshelf/git-github` posts commit statuses to GitHub so visual tests show up as PR checks. It implements the `GitHostProvider`/`GitHostAdapter` contracts from `@storyshelf/core`: the server reads each project's saved status config, decrypts its token, and posts `pending` while capturing, `success` when approved, and `failure` on rejection or capture errors, plus a single updatable PR comment (`<!-- storyshelf:<url> -->`). The adapter exposes `metadata` (`name`, `version`, `description`, `kind:"github"`, `logo`, `schema`) with `version` injected from `package.json` via `__PKG_VERSION__`.

## Install

```sh
nub add @storyshelf/git-github
```

## Register the provider

Pass `githubAdapter` in the `gitHosts` array of `createShelfRouter`:

```ts
import { createShelfRouter } from "@storyshelf/core";
import { githubAdapter } from "@storyshelf/git-github";

const app = createShelfRouter({
  database,
  storage,
  captureRunner,
  gitHosts: [githubAdapter],
  config: {
    secret: process.env.SHELF_SECRET, // also encrypts status tokens
  },
});
```

Multiple providers can be registered (e.g. `githubAdapter` plus a GitLab provider once available). `gitHosts` is an array — every registered provider that has a saved config for the build's project receives each status update (fanout per build) and hosts also expose `isMerged` (skip capture if PR already merged) and `upsertComment` (one comment per build).

## Configure a project

Status integrations are **per project**. Configure one from the UI under **Project → Settings → Git status**, or via the REST API:

```http
POST /api/v1/projects/{slug}/status-configs
Content-Type: application/json

{
  "provider": "github",
  "config": { "owner": "acme", "repo": "widgets" },
  "token": "github_pat_..."
}
```

- **`config`** — `{ owner, repo }`. Validated by `githubAdapter.metadata.schema`.
- **`token`** — a GitHub token with `repo:status` scope. It is stored encrypt-at-rest with AES-256-GCM keyed by the `secret` in `ShelfConfig`; only the `provider`, `config`, and `hasToken` flag are readable from the API.

Statuses are posted under the context `storyshelf/{project-slug}` (e.g. `storyshelf/my-app`), pointing at the build review page.

## Merge gate

Mark StoryShelf's status check as required in GitHub branch protection so PRs can't merge until visual review is approved. The check name is the context shown above.

## Direct use

For custom wiring, `createGitHubStatusAdapter({ token, owner, repo, logger? })` returns a bound `GitHostAdapter` that posts via `setStatus(context, gitSha, status, url)` and can `isMerged`/`upsertComment`. The template `githubAdapter: GitHostProvider` exposes `create({config, token, logger})` to create a configured instance per project.
