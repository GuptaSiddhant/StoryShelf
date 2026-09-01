---
title: CLI reference
description: The storyshelf command-line interface — init, upload, retry, and purge.
---

The StoryShelf CLI (`@storyshelf/cli`) exposes a `storyshelf` binary for CI pipelines. Install it globally, or prefix with `npx @storyshelf/cli`:

```bash
npm install -g @storyshelf/cli
```

:::note
This package is **client-only** — it talks to a running server over `/api/v1` and carries no Playwright or server dependencies. To run the server, use `storyshelf create` to scaffold a new project (see [Getting started](/guides/getting-started/)).
:::

## `storyshelf init`

Create a project and mint a CI token in one step.

```bash
storyshelf init --url http://localhost:3000 --name "My Design System"
```

Prints the project `slug` (used in all URLs) and the token. Keep the token secret.

## `storyshelf upload`

Build (optionally), zip, and upload a Storybook build for capture.

```bash
storyshelf upload \
  --url http://localhost:3000 \
  --slug my-design-system \
  --token shelf_xxx \
  --sha "$GITHUB_SHA" \
  --branch "$GITHUB_REF_NAME" \
  --storybook-dir storybook-static \
  --message "Fix button focus ring" \
  --author-name "Ada" \
  --author-email "ada@example.com" \
  --label "pr=123" \
  --label "jira=ABC-123"
```

| Flag | Description |
|------|-------------|
| `--url` | Server URL |
| `--slug` | Project slug |
| `--token` | Project API token (sent as `Authorization: Bearer`) |
| `--sha` | Git commit SHA |
| `--branch` | Git branch (used for baseline resolution) |
| `--storybook-dir` | Path to the static Storybook build (default `storybook-static`) |
| `--message` | Build message (commit message) |
| `--author-name`, `--author-email` | Author attribution |
| `--label key=value` | Attach a build label (repeatable) |

:::note
The CLI does **not** run Playwright. It zips the static build and uploads it; the server renders and diffs asynchronously. The upload request returns `202` immediately.
:::

The CLI also detects git tags on the uploaded SHA and attaches a `persistent` label per tag, so release builds survive retention. See [Labels](/concepts/labels/).

## `storyshelf retry`

Re-run capture for an existing build without a new commit — handy for flaky captures.

```bash
storyshelf retry --url http://localhost:3000 --slug my-design-system --build-id <id>
```

## `storyshelf purge`

Trigger a manual retention purge (normally it runs on a schedule).

```bash
storyshelf purge --url http://localhost:3000
```

Purges terminal builds older than `purge_ttl_days` (keeping the most recent per branch), removes their storage files and rows in one transaction, and cleans up orphaned baselines. Baselines and `persistent` builds are never purged.
