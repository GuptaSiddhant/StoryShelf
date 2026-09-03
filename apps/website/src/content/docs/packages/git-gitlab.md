---
title: "@storyshelf/git-gitlab"
description: GitLab commit-status provider for StoryShelf's visual-testing merge gate.
---

`@storyshelf/git-gitlab` posts commit statuses to GitLab so visual tests show up as MR checks. It implements the `GitHostProvider`/`GitHostAdapter` contracts from `@storyshelf/core`: the server reads each project's saved status config, decrypts its token, and posts `pending` while capturing, `success` when approved, and `failure` on rejection or capture errors, plus a single updatable MR note (`<!-- storyshelf:<url> -->`). The adapter exposes `metadata` (`name`, `version`, `description`, `kind:"gitlab"`, `logo`, `schema`) with `version` injected from `package.json` via `__PKG_VERSION__`.

## Install

```sh
nub add @storyshelf/git-gitlab
```

## Register the provider

Pass `gitLabHost` in the `gitHosts` array of `createShelfRouter`:

```ts
import { createShelfRouter } from "@storyshelf/core";
import { gitLabHost } from "@storyshelf/git-gitlab";

const app = createShelfRouter({
  database,
  storage,
  captureRunner,
  gitHosts: [gitLabHost],
  config: {
    secret: process.env.SHELF_SECRET,
  },
});
```

Multiple providers can be registered (e.g. `gitHubHost` plus `gitLabHost`). `gitHosts` is an array — every registered provider that has a saved config for the build's project receives each status update and hosts also expose `isMerged` (skip capture if MR already merged) and `upsertComment` (one note per build).

## Configure a project

Configure one from the UI under **Project → Settings → Git status**, or via the REST API:

```http
POST /api/v1/projects/{slug}/status-configs
Content-Type: application/json

{
  "provider": "gitlab",
  "config": { "owner": "acme", "repo": "widgets", "host": "https://gitlab.com" },
  "token": "glpat_..."
}
```

- **`config`** — `{ owner, repo, host? }`. `host` defaults to `https://gitlab.com` and is validated by `gitLabHost.metadata.schema`. For self-hosted GitLab set `host` to your instance URL.
- **`token`** — a GitLab token with `api` scope. Stored encrypt-at-rest with AES-256-GCM keyed by the `secret` in `ShelfConfig`.

Statuses are posted under the context `storyshelf/{project-slug}` (e.g. `storyshelf/my-app`). For GitLab this maps to `name`/`context` of the commit status.

## Merge gate

Mark StoryShelf's status as required in GitLab's protected branch settings or merge request approval rules so MRs can't merge until visual review is approved.

## Direct use

The package exports only `gitLabHost: GitHostProvider`. Create a bound instance per project via `gitLabHost.create({ config: { owner, repo, host }, token, logger })`, then `adapter.setStatus` / `adapter.upsertComment` / `adapter.isMerged`.
