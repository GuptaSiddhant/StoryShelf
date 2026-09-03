---
title: "@storyshelf/cli"
description: Create projects, upload Storybooks, and manage builds from CI — no Playwright, no server deps.
---

`@storyshelf/cli` provides the `storyshelf` binary for CI pipelines. It scaffolds servers, initializes client config, creates projects and tokens, uploads built Storybooks, retries captures, and purges expired builds — all over the server's `/api/v1` endpoints. It has **no Playwright or server dependencies**, so it installs cleanly in CI.

## Install

```sh
nub add @storyshelf/cli
```

## Use from CI

Scaffold a server (once):

```sh
storyshelf server init --dir ./my-shelf
```

Initialize client config (writes `.storybook/storyshelf.json`):

```sh
storyshelf init --url https://shelf.example.com --slug my-app
```

Create a project on the server (requires site-admin token, writes `.storybook/storyshelf.json`):

```sh
storyshelf create --url https://shelf.example.com --name my-app --token $STORYSHELF_ADMIN_TOKEN
```

Upload the built Storybook on each commit (when `.storybook/storyshelf.json` exists, `--url/--slug` can be omitted and `storyshelf` defaults to `upload`):

```sh
storyshelf upload --token "$STORYSHELF_TOKEN" --sha "$GIT_SHA" --branch "$GIT_BRANCH" \
  --storybook-dir storybook-static
# or simply: storyshelf (when config exists)
```

Use `storyshelf retry` for a failed capture and `storyshelf purge` for manual retention cleanup. The complete flags and CI workflows are in the [CLI reference](../../guides/cli/) and [CI setup guide](../../guides/ci/).

## How it fits

The CLI talks to the server's `/api/v1` endpoints. To start the server, use `storyshelf server init` to scaffold a new project, or see the [Deployment guide](../../guides/deployment/).
