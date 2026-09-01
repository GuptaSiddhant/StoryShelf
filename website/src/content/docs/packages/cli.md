---
title: "@storyshelf/cli"
description: Create projects, upload Storybooks, and manage builds from CI — no Playwright, no server deps.
---

`@storyshelf/cli` provides the `storyshelf` binary for CI pipelines. It creates projects and tokens, uploads built Storybooks, retries captures, and purges expired builds — all over the server's `/api/v1` endpoints. It has **no Playwright or server dependencies**, so it installs cleanly in CI.

## Install

```sh
nub add @storyshelf/cli
```

## Use from CI

Create a project and token once:

```sh
storyshelf init --url https://shelf.example.com --name my-app
```

Upload the built Storybook on each commit:

```sh
storyshelf upload --url https://shelf.example.com --slug my-app \
  --token "$STORY_SHELF_TOKEN" --sha "$GIT_SHA" --branch "$GIT_BRANCH" \
  --storybook-dir storybook-static
```

Use `storyshelf retry` for a failed capture and `storyshelf purge` for manual retention cleanup. The complete flags and CI workflows are in the [CLI reference](../../guides/cli/) and [CI setup guide](../../guides/ci/).

## How it fits

The CLI talks to the server's `/api/v1` endpoints. To start the server, use `storyshelf create` to scaffold a new project, or see the [Deployment guide](../../guides/deployment/).