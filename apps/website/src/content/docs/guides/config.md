---
title: Configuration
description: Configure StoryShelf via .storybook/storyshelf.json, flags, and env vars — precedence, monorepo, and examples.
---

StoryShelf is configured in layers: **flags > env > file > defaults**. Most teams keep a committed `.storybook/storyshelf.json` for non-secret values (`slug`, `url`, `buildDir`) and pass `token`, `sha`, `branch` via CI env.

## File: `.storybook/storyshelf.json`

Created by `storyshelf init` or `storyshelf create` (both fail if `.storybook/main.*` is missing):

```json
{
  "slug": "my-design-system",
  "url": "https://shelf.example.com",
  "buildDir": "storybook-static",
  "buildCommand": "npm run build-storybook -- --output-dir storybook-static",
  "buildScriptName": "build-storybook",
  "skip": "main"
}
```

| Field | CLI flag | Env fallback | Description |
|---|---|---|---|
| `slug` | `--slug` | `STORYSHELF_SLUG` | Project slug (required) |
| `url` | `--url` | `STORYSHELF_URL` | Server URL |
| `buildDir` | `--build-dir` / `-d` (`--storybook-dir` deprecated alias) | — | Built Storybook directory (default `storybook-static`). If missing or empty, `upload` will build |
| `buildCommand` | `--build-command` | — | Custom build command (e.g. `nx run app:build-storybook`). Mutually exclusive with `buildScriptName` |
| `buildScriptName` | `--build-script-name` / `-b` | — | npm script to run (default `build-storybook`) |
| `skip` | `--skip` | — | Glob to skip upload (e.g. `"main"`, `"release/*"`). `branch` matched via `picomatch`; when matched `upload` exits 0 without `POST` |

**Note:** `buildDir` default is Storybook's default `storybook-static` unless `buildDir` is set in file. `buildCommand` and `buildScriptName` are mutually exclusive (validated by `zod` `refine`).

### Custom config path

Use a non-standard location:

```bash
storyshelf upload --config ./config/storyshelf.json
# or
storyshelf upload -c ./my-config.json
# also:
storyshelf init --config ./config/storyshelf.json --url https://... --slug my-app
```

`--config/-c` overrides `.storybook/storyshelf.json` for `loadStorybookConfig(cwd, customPath)`.

## Precedence

```
flags (--url/--slug/--build-dir) > env (STORYSHELF_URL/SLUG/TOKEN, GITHUB_SHA/BRANCH) > file (.storybook/storyshelf.json) > defaults (storybook-static, build-storybook)
```

* `token` **never** stored in file — use `STORYSHELF_TOKEN` (project) or `STORYSHELF_ADMIN_TOKEN`/`ADMIN_TOKEN` (site-admin for `create`/`purge`).
* `sha`/`branch` default to `GITHUB_SHA`/`GITHUB_REF_NAME` (`VERCEL_GIT_COMMIT_*`, `CI_COMMIT_*`).

## Monorepo

One file **per Storybook** (`1 project = 1 Storybook`):

```
apps/app/.storybook/storyshelf.json: { "slug": "app", "url": "https://shelf.example.com", "buildDir": "../../dist/storybook-app" }
packages/ds/.storybook/storyshelf.json: { "slug": "design-system", "buildDir": "../../dist/storybook-ds" }
```

Each upload resolves `packagePath` (`relative(cwd, dirname(.storybook))`) and is independent.

## Build before upload

`storyshelf upload` (and `storyshelf` with no args defaults to `upload` when config exists, else shows help to run `init`):

1. `skip` glob matches `branch` → exit 0, no `POST`.
2. `buildDir` missing or empty or `--force-build` → run `buildCommand` or `npm run <buildScriptName> -- --output-dir <buildDir>`.
3. `zip.addLocalFolder(buildDir)` → `POST /api/v1/projects/{slug}/builds`.

## Server config vs client config

* **Client file** (`.storybook/storyshelf.json`): `slug`, `url`, `buildDir`, `buildCommand`, `buildScriptName`, `skip` — per-Storybook, committed, non-secret.
* **Server `ShelfConfig` / DB `projects`** (`core/src/config.ts:48`, `core/src/schema.ts:5`): `secret`, `captureConcurrency`, `scratchDir`, `purgeTtlDays`, `viewports`, `pixel_threshold`, `storybook_meta` (`framework/addons/storiesGlobs/packagePath` auto-detected at `create`).

## Validation

File is validated with `storybookConfigSchema` (`cli/src/config.ts:7` `z.object({slug, url: z.url().optional(), buildDir?, buildCommand?, buildScriptName?, skip?}).refine(...)`). Manual edits that fail validation fall back to `null` (ignored) and `upload` will error missing `slug`/`url` with a helpful message.

## Examples

```bash
# 1. Scaffold server
storyshelf server init --dir ./my-shelf

# 2. Init client config (fails if .storybook/main.* missing, prompts if flags missing)
storyshelf init --url https://shelf.example.com --slug my-app
storyshelf init # prompts for url/slug, shows detected framework • addons

# 3. Create project on server (requires admin token, auto-detects git + storybookMeta, writes config)
storyshelf create --url https://shelf.example.com --name "My App" --token $STORYSHELF_ADMIN_TOKEN

# 4. Upload (explicit)
storyshelf upload --token $STORYSHELF_TOKEN --sha $GITHUB_SHA --branch $GITHUB_REF_NAME
# with config present, url/slug/buildDir omitted — also `storyshelf` with no args defaults to upload
```
