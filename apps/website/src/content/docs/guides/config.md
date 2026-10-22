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
  "skip": "main",
  "affectedOnly": true,
  "untraced": ["**/*.generated.ts"]
}
```

| Field             | CLI flag                     | Env fallback                  | Description                                                                                                                        |
| ----------------- | ---------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `slug`            | `--slug`                     | `STORYSHELF_SLUG`             | Project slug (required)                                                                                                            |
| `url`             | `--url`                      | `STORYSHELF_URL`              | Server URL                                                                                                                         |
| `buildDir`        | `--build-dir` / `-d`         | —                             | Built Storybook directory (default `storybook-static`). If missing or empty, `upload` will build                                   |
| `buildCommand`    | `--build-command`            | —                             | Custom build command (e.g. `nx run app:build-storybook`). Mutually exclusive with `buildScriptName`                                |
| `buildScriptName` | `--build-script-name` / `-b` | —                             | package script to run (default `build-storybook`)                                                                                  |
| `skip`            | `--skip`                     | —                             | Glob to skip upload (e.g. `"main"`, `"release/*"`). `branch` matched via `picomatch`; when matched `upload` exits 0 without `POST` |
| `affectedOnly`    | `--full` (opt-out)           | `STORYSHELF_FULL=1` (opt-out) | Render only impacted stories (default `true`). See [Affected capture](/concepts/affected-capture/)                                 |
| `untraced`        | `--untraced` (union)         | —                             | Trace exclusions, combined with `--untraced` flags. See [Affected capture](/concepts/affected-capture/)                            |

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

- `token` **never** stored in file — use `STORYSHELF_TOKEN` (project) or `STORYSHELF_ADMIN_TOKEN`/`ADMIN_TOKEN` (site-admin for `create`/`purge`).
- `sha`/`branch` resolve per field as flags > env (`GITHUB_SHA`/`GITHUB_REF_NAME`, `VERCEL_GIT_COMMIT_*`, `CI_COMMIT_*`) > local git (`rev-parse HEAD`, current branch) > synthesized local identity (`local-<random>` on branch `local`). No git, no flags, no env still uploads — see [Uploading without git](/guides/without-git/). For gitless pipelines, pass explicit values per run (e.g. `--sha <run-id> --branch staging`); each unique sha chains baselines normally.

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
2. `buildDir` missing or empty or `--force-build` → run `buildCommand` or the detected package runner's script invocation (`npm run <buildScriptName> -- --output-dir <buildDir>`; `pnpm`/`bun`/`nub run <buildScriptName> --output-dir <buildDir>`; `yarn <buildScriptName> --output-dir <buildDir>`; `deno task <buildScriptName> --output-dir <buildDir>`) with `STORYBOOK_BUILD_STORIES_JSON=true` (so Storybook emits `stories.json` with `parameters` for per-story controls like `disableSnapshot`/`flakyTest` — see **Interaction testing**). The runner is detected from the invoking agent env, then the `packageManager` field, then lockfiles (`nub.lock`, `bun.lockb`/`bun.lock`, `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `deno.lock`), defaulting to `npm`.
3. `zip.addLocalFolder(buildDir)` → `POST /api/v1/projects/{slug}/builds`.

## Server config vs client config

- **Client file** (`.storybook/storyshelf.json`): `slug`, `url`, `buildDir`, `buildCommand`, `buildScriptName`, `skip`, `affectedOnly`, `untraced` — per-Storybook, committed, non-secret.
- **Server `ShelfConfig` / DB `projects`** (`core/src/config.ts:48`, `core/src/schema.ts:5`): `secret` (see [rotating it](/guides/deployment/secret-rotation/)), `previousSecret`, `migrateCredentialsOnBoot`, `scratchDir` (default `<os.tmpdir()>/storyshelf`), `purgeTtlDays`, `branchTtlDays`, `branchGcIntervalMs`, `maxUploadBytes`, `maxInlineUnzipSize`, `maxZipEntries`, `maxUnzippedBytes`, `viewports`, `browser` (per-project capture target: an engine the runner offers, or `<engine>@<name>`), `pixel_threshold`, `storybook_meta` (`framework/addons/storiesGlobs/packagePath` auto-detected at `create`).

Publishing a Storybook zip is bounded by three options (see [Published Storybook](/concepts/publishing/)):

- `maxInlineUnzipSize` (default 50 MB): zips up to this many bytes are extracted inline in the upload request, so the Storybook is live when the upload returns. Larger zips are published by a background `publish` job on any instance with a database; on a serverless host they are refused with `413`, pointing to the file-by-file upload route (`/dedup`, `/content`, `/manifest`). `0` sends every zip to a job. The size is counted while streaming, not from `Content-Length`.
- `maxZipEntries` (default 50 000): the most entries a zip may hold.
- `maxUnzippedBytes` (default 2 GiB): the most uncompressed bytes a zip may expand to, counted while extracting.

A zip over a cap, or with an absolute or `..` path, fails the publish. `scratchDir` now always defaults to `<os.tmpdir()>/storyshelf`, since publishing extracts zips there with or without `testing`.

### The `testing` option and hosting only

`createShelfApp` takes one umbrella option, `testing`. Set, it turns on capture, compare, baselines and the `<prefix>/testing` status; absent, the instance **hosts Storybooks only** (see [Hosting only](/concepts/hosting-only/)).

```ts
createShelfApp({ database, storage }); // hosting only
createShelfApp({ database, storage, testing: { runner, compare: { threads: 2 }, concurrency: 2 } });
```

- Enabling `testing` requires a long-running server (a container, VM, Fly Machine or Kubernetes pod); a serverless deployment can host Storybooks only, by leaving `testing` unset. See [Capture](/concepts/capture/#requires-a-long-running-server) and [Hosting only](/concepts/hosting-only/).
- `testing` needs `runner`, or `queue` to hand jobs to a queue that something else consumes; `testing: {}` fails at boot.
- `testing.storybookUrlRateLimit` (requests per minute per client IP, default `6000`) caps the signed Storybook URL route a remote browser that cannot route back reads through; it needs a `secret` and a [public origin](#public-origin). How long such a URL stays valid is derived from the build's size and can be set per project (**Settings → Capture**). See [Signed Storybook URLs](/guides/remote-browsers/#signed-storybook-urls).
- `compare`, `images`, `concurrency`, `retries`, `leaseSeconds`, `shardSize`, `storybookUrlRateLimit`, `workerEntry`, `mode` and `queue` all live under `testing`; they are unreachable without it.
- `testing.leaseSeconds` (default `300`, five minutes) is how long a running job may go without a renewal before another instance claims it again. A running job renews its lease on a timer (every 30 s, or a third of a shorter lease) and on progress, so a stage that prints nothing is not redelivered while its process lives; a crashed instance's jobs are recovered once the lease runs out, so a shorter lease recovers crashes sooner. It applies to the database queue only.
- Captures queue on the database (`capture_jobs`), and every instance with `testing` consumes them. `testing.retries` (default `2`, so three attempts) is the one retry limit for failed attempts, lost leases and forked-child crashes. `testing` requires a `runner` and there is no queue option. See [Capture](/concepts/capture/#the-job-queue).
- `config.scratchDir` stays in `config`, because publishing uses it too.
- Routes for capture, compare and baselines answer `404` without `testing`; the navigation hides them; the System page and `storyshelf upload` say the instance is hosting only.
- A process that renders (`testing.runner`) needs a long-running host. Boot throws on AWS Lambda (`AWS_LAMBDA_FUNCTION_NAME`), logs a warning on Vercel and Netlify, and throws when the database is the Cloudflare D1 preset. `STORYSHELF_ALLOW_SERVERLESS=1` overrides the host check (not the D1 one).

### Capture performance tuning

- `testing.concurrency` (a `createShelfApp` option, formerly `config.captureConcurrency`) sets how many jobs this instance runs at once.
- The Playwright and Puppeteer runners' own `concurrency` option pins how many pages render at once. Left unset, the runner starts from a CPU/memory-sized budget (Firefox and WebKit pages count as two Chromium slots) and adapts: it raises the limit while capture latency and event-loop lag stay flat, halves it on timeouts, and logs every change as `capture concurrency adjusted`.
- `testing.compare.threads` (a `createShelfApp` option) or `STORYSHELF_DIFF_WORKERS` sets how many worker threads compare screenshots (default: CPU count minus one, minimum 1; the option wins over the variable). `0` diffs on the main thread. The pool serves both capture and the re-diff endpoint, so it matters on servers that never render.

### Image engine

- `testing.images.engine` (a `createShelfApp` option) or `STORYSHELF_IMAGE_ENGINE` picks the PNG library for diffs, diff overlays, and AI thumbnails: `"pngjs"` (default, pure JavaScript, runs anywhere) or `"sharp"` (native, faster on large screenshots; install the optional `sharp` package). The option wins over the variable. An unknown name fails at startup, and so does `"sharp"` without the package installed. See [Image engines](/guides/image-engines/).

### Public origin

Links built in the background (commit statuses, notification emails, and the [signed Storybook URLs](/guides/remote-browsers/#signed-storybook-urls) that remote browsers without a route back open) need the address people reach the server at. StoryShelf resolves it from a chain and never from the `Host` or `X-Forwarded-Host` of a request, which can be forged. **An address is used only once it is confirmed**: one you configured, one the platform states, or one a site admin confirmed. An address StoryShelf merely detected from a browser is a suggestion until then, and no link, notification or signed URL is built on it.

1. `publicBaseUrl` (`PUBLIC_BASE_URL` in the scaffolds), when set.
2. The platform's own address, read from its environment: Heroku (`HEROKU_APP_DEFAULT_DOMAIN_NAME`, needs the `runtime-dyno-metadata` Labs feature), Railway (`RAILWAY_PUBLIC_DOMAIN`), Vercel (`VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_URL`), Netlify (`URL`), Render (`RENDER_EXTERNAL_URL`), Fly.io (`FLY_APP_NAME`), Azure App Service (`WEBSITE_HOSTNAME`), Azure Container Apps (`CONTAINER_APP_NAME` with `CONTAINER_APP_ENV_DNS_SUFFIX`) and DigitalOcean App Platform (`APP_URL`). Cloud Run, AWS App Runner, Lambda function URLs and Cloudflare Workers publish none. This is the platform's domain, a working fallback but the wrong link behind a custom domain.
3. The address a site admin confirmed on **System**. The page reports the `location.origin` it was opened with and the server stores the first one it hears in `site_settings`, but that address stays **unconfirmed** and unused until the admin presses **Confirm** (or types another address and saves it) in **System → Public origin**; the page then says "Public origin detected, not confirmed. Confirm it to enable notifications and signed Storybook URLs". An admin can also forget it. With authentication off there is no admin, so nothing is learnt.

So a first deploy needs no redeploy to learn its URL: open **System** once and confirm the address. While nothing is confirmed, **notifications are paused**: no commit status, pull-request comment, chat, email or log message is sent (every one carries a link), no channel is marked as failing, and **System**, the project's notification settings and your profile say "Notifications are paused until a public URL is set". Once an admin confirms an origin, the builds still pending or in review are shown again; with `PUBLIC_BASE_URL` set at start-up the git statuses and pull-request comments of those builds (the newest 25 per project) are requested again once the server is ready, and chat, email and alerts resume with the next state change. Capture targets that reach the Storybook by URL stay unavailable.

**Authentication is the one exception.** The OAuth callback URLs (`/connections/<service>/callback`) and the `/.well-known/openid-configuration` helper are interactive and belong to the request in front of them, so they use the confirmed origin when there is one and otherwise the address the request itself came in on. Nothing that outlives the request (a link in an email or status, a signed URL) ever does. Pin `PUBLIC_BASE_URL` when a custom domain fronts the app.

## Validation

File is validated by the CLI's config parser (`cli/src/config.ts`): unknown keys are ignored, and any present-but-invalid field (`url` shape, `buildCommand`+`buildScriptName` together, non-boolean `affectedOnly`, malformed `untraced`) invalidates the whole file — `upload` then errors on the missing `slug`/`url` with a helpful message.

## Editor support (`$schema`)

`storyshelf init` stamps a `$schema` pointer into new configs for autocomplete, hover docs, and inline validation:

- **Local install** (CLI on disk): a path relative to the config file, e.g. `"../../node_modules/storyshelf/schema/storyshelf-config.json"` — exact version match, works offline.
- **Otherwise** (global install, `npx`): a versioned URL, e.g. `"https://unpkg.com/storyshelf@0.5.2/schema/storyshelf-config.json"` (unversioned `…/storyshelf/schema/…` when the version is unknown).

`storyshelf create` and config merges preserve an existing stamp; `init` refreshes it. To add it to an existing file by hand, use either form above. The schema ships inside the CLI package, so it always describes the parser that enforces it.

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
