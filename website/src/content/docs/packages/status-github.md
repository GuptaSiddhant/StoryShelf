---
title: "@storyshelf/status-github"
description: GitHub commit-status provider for StoryShelf's visual-testing merge gate.
---

`@storyshelf/status-github` posts commit statuses to GitHub so visual tests show up as PR checks. It implements the `StatusProvider` / `StatusAdapter` contracts from `@storyshelf/core`: the server reads each project's saved status config, decrypts its token, and posts `pending` while capturing, `success` when approved, and `failure` on rejection or capture errors.

## Install

```sh
nub add @storyshelf/status-github
```

## Register the provider

Pass `githubStatusProvider` in the `statusProviders` array of `createShelfRouter`:

```ts
import { createShelfRouter } from "@storyshelf/core";
import { githubStatusProvider } from "@storyshelf/status-github";

const app = createShelfRouter({
  database,
  storage,
  captureRunner,
  statusProviders: [githubStatusProvider],
  config: {
    secret: process.env.SHELF_SECRET, // also encrypts status tokens
  },
});
```

Multiple providers can be registered (e.g. `githubStatusProvider` plus a GitLab provider once available). `statusProviders` is an array — every registered provider that has a saved config for the build's project receives each status update (fanout per build).

## Configure a project

Status integrations are **per project**. Configure one from the UI under **Project → Settings → Git status**, or via the REST API:

```http
POST /api/v1/projects/{slug}/status-configs
Content-Type: application/json

{
  "provider": "github",
  "config": { "owner": "acme", "repo": "widgets", "contextPrefix": "ci" },
  "token": "github_pat_..."
}
```

- **`config`** — `{ owner, repo, contextPrefix? }`. `contextPrefix` defaults to `storyshelf`.
- **`token`** — a GitHub token with `repo:status` scope. It is stored encrypt-at-rest with AES-256-GCM keyed by the `secret` in `ShelfConfig`; only the `provider`, `config`, and `hasToken` flag are readable from the API.

Statuses are posted under the context `{contextPrefix}/{project-slug}` (e.g. `storyshelf/my-app`), pointing at the build review page.

## Merge gate

Mark StoryShelf's status check as required in GitHub branch protection so PRs can't merge until visual review is approved. The check name is the context shown above.

## Direct use

For custom wiring, `createGitHubStatusAdapter({ token, owner, repo, contextPrefix?, logger? })` returns a bare `StatusAdapter` that posts a single `setStatus(context, gitSha, status, url)` without the config-descriptor machinery.