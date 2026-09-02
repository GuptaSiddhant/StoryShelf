---
title: CLI reference
description: The storyshelf command-line interface — init, create, server, upload, retry, and purge.
---

The StoryShelf CLI (`@storyshelf/cli`) exposes a `storyshelf` binary for CI pipelines. Install it globally, or prefix with `npx @storyshelf/cli`:

```bash
npm install -g @storyshelf/cli
```

:::note
This package is **client-only** — it talks to a running server over `/api/v1` and carries no Playwright or server dependencies. To scaffold a server, use `storyshelf server init` (see [Getting started](/guides/getting-started/)).
:::

## `storyshelf init`

Initialize the current Storybook with `.storybook/storyshelf.json` (client config). Fails if `.storybook/main.*` is not found.

```bash
storyshelf init --url http://localhost:3000 --slug my-design-system --build-dir storybook-static
# or with prompts:
storyshelf init
# ? Server URL? http://localhost:3000 (detected React-Vite • 1 addons)
# ? Project slug? my-design-system
# also: --build-dir, --build-command, --build-script-name, --skip, -c/--config
```

Writes `.storybook/storyshelf.json: { "slug": "...", "url": "...", "buildDir": "...", "skip": "..." }` (no token, see [Configuration](/guides/config/)). Token stays in `STORYSHELF_TOKEN` env / `--token`. If flags are missing, prompts are shown with detected framework hints.

## `storyshelf create`

Create a project on the server (requires site-admin token) and write `.storybook/storyshelf.json`. Fails if `.storybook/main.*` is not found.

```bash
storyshelf create --url http://localhost:3000 --name "My Design System" --token $STORYSHELF_ADMIN_TOKEN
# also reads STORYSHELF_ADMIN_TOKEN / ADMIN_TOKEN env if --token omitted
```

Prints `Project slug: ...` and `CI token: ...` and writes `.storybook/storyshelf.json`. Store `CI token` in secrets (`STORYSHELF_TOKEN`).

## `storyshelf server init`

Scaffold a new StoryShelf server project.

```bash
storyshelf server init
# ? Project name? my-storyshelf
# ? Directory? ./my-storyshelf
# ? Which database? SQLite
# ? Which storage? Local filesystem
# ? Which auth? None
# ? Which git provider? GitHub
```

Generates `server.ts` + `package.json` (and `Dockerfile`/`compose.yaml` if selected) in the target directory.

## `storyshelf upload`

Build (optionally), zip, and upload a Storybook build for capture. When `.storybook/storyshelf.json` exists (`slug`, `url`, `buildDir`, `skip` — see [Configuration](/guides/config/)), `--url`/`--slug` can be omitted and are resolved as `flags > env > file` (`STORYSHELF_TOKEN`/`GITHUB_SHA`/`GITHUB_REF_NAME` are fallback envs). If `buildDir` is missing or empty or `--force-build` is given, `upload` runs `buildCommand` or `npm run <buildScriptName>` before zipping.

```bash
# explicit flags
storyshelf upload \
  --url http://localhost:3000 \
  --slug my-design-system \
  --token shelf_xxx \
  --sha "$GITHUB_SHA" \
  --branch "$GITHUB_REF_NAME"

# with .storybook/storyshelf.json present (no args defaults to upload)
storyshelf
# or
storyshelf upload --token shelf_xxx --sha $GITHUB_SHA --branch main
# with custom config path
storyshelf upload --config ./config/storyshelf.json --force-build
```

| Flag | Description |
|------|-------------|
| `--url` | Server URL (or `.storybook/storyshelf.json` / `STORYSHELF_URL`) |
| `--slug` | Project slug (or `.storybook/storyshelf.json` / `STORYSHELF_SLUG`) |
| `--token` | Project API token (sent as `Authorization: Bearer`, or `STORYSHELF_TOKEN`) |
| `--sha` | Git commit SHA (or `GITHUB_SHA`) |
| `--branch` | Git branch (or `GITHUB_REF_NAME`) |
| `--build-dir` / `-d` | Built Storybook directory (default `storybook-static`, or file `buildDir`; `--storybook-dir` deprecated alias) |
| `--config` / `-c` | Config file path (default `.storybook/storyshelf.json`) |
| `--build-command` | Custom build command (e.g. `nx run app:build-storybook`, mutually exclusive with `--build-script-name`) |
| `--build-script-name` / `-b` | npm script to build Storybook (default `build-storybook`) |
| `--force-build` | Force rebuild even if `buildDir` exists |
| `--skip` | Glob to skip upload (e.g. `"main"`, `"release/*"` — file `skip` also supported) |
| `--message` | Build message (commit message) |
| `--author-name`, `--author-email` | Author attribution |
| `--label key=value` | Attach a build label (repeatable) |

:::note
The CLI does **not** run Playwright. It zips the static build and uploads it; the server renders and diffs asynchronously. The upload request returns `202` immediately.
:::

When run with no subcommand, `storyshelf` defaults to `upload` if `.storybook/storyshelf.json` exists, otherwise shows help to run `storyshelf init`.

The CLI also detects git tags on the uploaded SHA and attaches a `persistent` label per tag, so release builds survive retention. See [Labels](/concepts/labels/).

## `storyshelf retry`

Re-run capture for an existing build without a new commit — handy for flaky captures.

```bash
storyshelf retry --url http://localhost:3000 --slug my-design-system --build-id <id> [--token $STORYSHELF_TOKEN]
```

## `storyshelf purge`

Trigger a manual retention purge (normally it runs on a schedule). Requires site-admin token when auth is enabled.

```bash
storyshelf purge --url http://localhost:3000 --token $STORYSHELF_ADMIN_TOKEN
```

Purges terminal builds older than `purge_ttl_days` (keeping the most recent per branch), removes their storage files and rows in one transaction, and cleans up orphaned baselines. Baselines and `persistent` builds are never purged.
