---
title: "@storyshelf/cli"
description: Run StoryShelf, create projects, upload Storybooks, and manage builds from CI.
---

`@storyshelf/cli` provides the `storyshelf` binary for operators and CI pipelines. It starts a server, creates projects and tokens, uploads built Storybooks, retries captures, and purges expired builds.

## Install

```sh
nub add @storyshelf/cli
```

## Start a server

```sh
storyshelf serve -p 3000 --data-dir ./data --secret <secret> \
  --capture-concurrency 2 --purge-ttl-days 30
```

Defaults are port `3000`, data directory `./data`, capture concurrency `2`, and a 30-day purge TTL. The server uses SQLite and local storage by default.

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

The CLI talks to the server's `/api/v1` endpoints. `serve` composes `@storyshelf/core`, `@storyshelf/db-sqlite`, and `@storyshelf/storage-local`; the other commands operate against an already-running server.
