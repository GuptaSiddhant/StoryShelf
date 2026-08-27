---
title: CLI reference
description: The storyshelf command-line interface — serve, init, upload, retry, and purge.
---

The StoryShelf CLI (`@storyshelf/cli`) exposes a `storyshelf` binary. Install it globally, or prefix with `npx @storyshelf/cli`:

```bash
npm install -g @storyshelf/cli
```

## `storyshelf serve`

Run the server (dev mode, or a lightweight self-hosted deployment).

```bash
storyshelf serve \
  -p 3000 \
  --data-dir ./data \
  --secret "a-long-random-secret" \
  --capture-concurrency 2 \
  --purge-ttl-days 30
```

| Flag | Description |
|------|-------------|
| `-p, --port` | HTTP port (default `3000`) |
| `--data-dir` | Where SQLite + screenshots live (default `./data`) |
| `--secret` | Session-cookie signing secret (required for auth) |
| `--capture-concurrency` | Parallel captures (default `2`) |
| `--purge-ttl-days` | Retention TTL for terminal builds (default `30`) |

The server renders stories with Playwright in-process, so the machine needs Playwright's browsers installed. The official Docker image includes them.

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
