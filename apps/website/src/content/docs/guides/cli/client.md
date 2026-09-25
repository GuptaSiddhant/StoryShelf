---
title: CLI — Client
description: storyshelf init, create, upload, build, doctor, whoami, retry, purge — client-side commands.
---

The client CLI talks to a running StoryShelf server over `/api/v1` and carries no Playwright or server dependencies. Install it globally or via `npx`:

```bash
npm install -g storyshelf
# or
npx storyshelf --help
```

> **Package reference:** For install and programmatic use see [@storyshelf/cli](/packages/cli/).

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

Writes `.storybook/storyshelf.json: { "slug": "...", "url": "...", "buildDir": "...", "skip": "..." }` (no token, see [Configuration](/guides/config/)). Token stays in `STORYSHELF_TOKEN` env / `--token`.

## `storyshelf create`

Create a project on the server (requires site-admin token) and write `.storybook/storyshelf.json`.

```bash
storyshelf create --url http://localhost:3000 --name "My Design System" --token $STORYSHELF_ADMIN_TOKEN
# also reads STORYSHELF_ADMIN_TOKEN / ADMIN_TOKEN env if --token omitted
```

Prints `Project slug: ...` and `CI token: ...`.

## `storyshelf build`

Build the Storybook output without uploading — same `buildDir`/`buildCommand` resolution as `upload`, but no server contact.

```bash
storyshelf build
storyshelf build --force-build
storyshelf build --build-dir dist-storybook --build-command "nx run app:build-storybook"
```

Prints `Build ready: <dir>` and fails fast when the output lacks `index.json`.

## `storyshelf upload`

Build (optionally), zip, and upload a Storybook build for capture.

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
storyshelf upload --token shelf_xxx --sha $GITHUB_SHA --branch main
```

| Flag | Description |
|------|-------------|
| `--url` | Server URL (or file / `STORYSHELF_URL`) |
| `--slug` | Project slug (or file / `STORYSHELF_SLUG`) |
| `--token` | Project API token (`Authorization: Bearer`, or `STORYSHELF_TOKEN`) |
| `--sha` | Revision SHA (flag, CI env, local git HEAD, or synthesized `local-*`) |
| `--branch` | Baseline namespace (flag, CI env, local git branch, or `local`) |
| `--build-dir` / `-d` | Built Storybook directory (default `storybook-static`) |
| `--config` / `-c` | Config file path (default `.storybook/storyshelf.json`) |
| `--build-command` | Custom build command (mutually exclusive with `--build-script-name`) |
| `--build-script-name` / `-b` | npm script to build (default `build-storybook`) |
| `--force-build` | Force rebuild even if `buildDir` exists |
| `--skip` | Glob to skip upload (e.g. `"main"`) |
| `--message` | Build message |
| `--author-name`, `--author-email` | Author attribution |
| `--label key=value` | Attach a build label (repeatable) |
| `--full` | Disable affected capture for this upload (render every story) |
| `--untraced <glob>` | Exclude matching files from affected tracing (repeatable, e.g. `"**/*.generated.ts"`) |
| `--stats-file <path>` | Bundler stats file (default `<buildDir>/preview-stats.json`) |
| `--dry-run` | Validate/build but send no requests |

Affected capture is on by default: the CLI traces `git diff baseline..HEAD` through the build's dependency graph, posts the affected set, and prints a summary (`Affected capture: rendering 3 stories (baseline abc1234)`). Anything it cannot prove unchanged renders anyway — see [Affected capture](/concepts/affected-capture/). `STORYSHELF_FULL=1` and `"affectedOnly": false` opt out the same way as `--full`.

:::note
The CLI does **not** run Playwright. It streams the zipped static build to the server; the server renders and diffs asynchronously (`202`).
:::

## `storyshelf doctor` / `whoami`

```bash
storyshelf doctor
# ✓ Storybook setup found
# ✓ Config loaded (slug "my-design-system")
# ✓ Connection: http://localhost:3000 / my-design-system (token present)
# ✓ Server reachable
# ! Build output missing — upload would run: npm run build-storybook -- --output-dir storybook-static
# ✓ Affected capture ready (history and stats available)

storyshelf whoami
# Server: http://localhost:3000
# Project: My Design System (my-design-system)
```

## `storyshelf retry` / `purge`

```bash
storyshelf retry --url http://localhost:3000 --slug my-design-system --build-id <id> [--token $STORYSHELF_TOKEN]
storyshelf purge --url http://localhost:3000 --token $STORYSHELF_ADMIN_TOKEN
```

`retry` re-runs capture without a new revision. `purge` triggers retention GC (normally scheduled).

See [Configuration](/guides/config/) for file/env precedence and [Labels](/concepts/labels/) for `persistent` tagging.
