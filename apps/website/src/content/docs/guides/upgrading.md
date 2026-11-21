---
title: Upgrading guide
description: Every change in 0.14 and 0.15 that needs action from you, with who is affected and the exact steps. Start here when you move from 0.13 or 0.14.
---

This page lists the changes that need something from you, one section per release, newest first. Nothing here replaces the [changelog](/changelog/), which lists every change. For what every release promises (in-place upgrades, one release of rollback, breaking changes only in a minor), see [Upgrading and support](/guides/support/#what-a-release-promises).

Before any upgrade, [back up](/guides/backup-restore/) the database and the storage, then follow the steps in [Upgrading and support](/guides/support/#upgrading). Coming from 0.12 or older? Read the changelog for each release in between as well.

## Before 2027

Until 1 January 2027, every 0.x release can break things, and nothing old is kept working: no deprecated re-export packages, no aliases for renamed exports, options or environment variables, and no two-step schema changes.

- Read the `Breaking:` lines of each release in the [changelog](/changelog/) before you upgrade.
- A release whose notes carry a `Schema:` line with a contract step (a dropped or renamed column, a new `NOT NULL`, a unique index) needs a **stop-the-world upgrade**: stop every instance of the old release, then start the new one. Do not run old and new side by side across it.
- A rollback across such a release is a restore from your [backup](/guides/backup-restore/).

From 2027-01-01 the compatibility rules apply again: one release of rollback, expand-then-contract schema changes and one minor release of deprecated re-exports.

## 0.15.0 (in progress)

0.15.0 is not released yet. This section lists what is already decided and will change as the release firms up. Each rename below has no alias: the old name stops working in 0.15.0.

### `@storyshelf/storage-local` is removed

**Who is affected:** a server that imports `createLocalStorage` from `@storyshelf/storage-local`.

Local storage is built into core. Import it from `@storyshelf/core/storage/local` (same factory, same options) and remove `@storyshelf/storage-local` from your `package.json`. The package is not published again and is marked deprecated on npm with the new path.

### `@storyshelf/runner-puppeteer` is removed

**Who is affected:** a server that builds its capture runner with `createPuppeteerCaptureRunner` from `@storyshelf/runner-puppeteer`. If you use the Playwright runner, nothing changes here (see the rename below).

0.14.0 deprecated the package and 0.15.0 removes it ([ADR 0001](https://github.com/GuptaSiddhant/StoryShelf/blob/main/docs/adr/0001-architecture-and-conventions.md), amendment 2026-11-20). Switch to the Playwright runner while you are still on 0.14.x, then upgrade. The steps, the option mapping and the note about the new baseline are in [Switching from Puppeteer to Playwright](#switching-from-puppeteer-to-playwright).

### `@storyshelf/runner-playwright` is now `@storyshelf/runner`

**Who is affected:** a server that imports `@storyshelf/runner-playwright` or `@storyshelf/runner-playwright/remote`, or scaffolded one with `server init` before 0.15.0.

With Puppeteer gone there is one runner, so it has the plain name. Nothing else changes: the same options, the same subpaths, the same captures and no new baseline.

1. Replace the dependency: remove `@storyshelf/runner-playwright` and add `@storyshelf/runner`.
2. Change the imports: `@storyshelf/runner-playwright` becomes `@storyshelf/runner`, and `@storyshelf/runner-playwright/remote` becomes `@storyshelf/runner/remote`.
3. Rename the factory: `createPlaywrightCaptureRunner` is now `createCaptureRunner`.

There is no alias and no re-export: `@storyshelf/runner-playwright` is not published again, and the owner deprecates the npm package with a message naming the new one.

### Switching from Puppeteer to Playwright

Playwright is the one capture runner. Do this on 0.14.x, before you upgrade to 0.15.0.

1. Install `@storyshelf/runner-playwright` (0.14.x; after 0.15.0 it is `@storyshelf/runner`), run `playwright install chromium` (or use an image that has it) and remove `@storyshelf/runner-puppeteer`.
2. Change the import and factory: `createPuppeteerCaptureRunner` becomes `createPlaywrightCaptureRunner` from `@storyshelf/runner-playwright`.
3. Map the options:

| Puppeteer                                                                               | Playwright                                                                                                                              |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `executablePath` for a system Chrome, or `local("chrome", { executablePath })`          | `local("chrome", { channel: "chrome" })` (bare `"chrome"` uses the same channel; `chrome-beta` and `msedge` also work)                  |
| `executablePath` for any other Chromium                                                 | No path option: `playwright install chromium` and the bare `"chromium"` target                                                          |
| `args` (launch flags)                                                                   | No equivalent option                                                                                                                    |
| `cdp({ name, endpoint, headers, sessions })` from `@storyshelf/runner-puppeteer/remote` | `remote({ name, protocol: "cdp", reach: "url", sessions, connect: { endpoint, headers } })` from `@storyshelf/runner-playwright/remote` |
| `concurrency`, `navigationTimeoutMs`, `recycleBrowserEvery`, `reusePages`               | The same options on `createPlaywrightCaptureRunner`                                                                                     |

4. Expect one new baseline. The capture fingerprint (browser build, platform, fonts) changes with the runner, so the first build on the default branch is accepted as an environment migration, and branch builds show differences to review. A CDP remote keeps its `chromium@<name>` target and its own baselines.

### StoryShelf's environment variables use the `SHELF_` prefix

**Who is affected:** everyone who sets StoryShelf's variables (a server, the image, the CLI in CI, an MCP client). **Rename them before you upgrade.**

StoryShelf's own settings are now `SHELF_*`. A name stays unprefixed only when a platform, SDK or specification defines it and StoryShelf reads it with that meaning: `PORT`, `HOST`, `NODE_ENV`, `DATABASE_URL`, `AWS_*`, `AZURE_CLIENT_ID`, `GOOGLE_CLOUD_PROJECT`, `OTEL_*`, `PLAYWRIGHT_SERVICE_*`, `ANTHROPIC_API_KEY`, `TURSO_*`, and platform facts such as `CI_*`, `GITHUB_*`, `VERCEL_*` and `FLY_APP_NAME`.

- The old names are not read any more; there are no aliases.
- So that an upgrade cannot silently drop a setting, the server (the image, the Fly app and the dev server), the CLI and the MCP server refuse to start while any old name in the table below is set. The refusal lists each old name with its new one and never prints a value. This holds even when the new name is set too: unset the old one.
- If another service in the same environment sets one of these generic names for itself (`LOG_LEVEL`, `DATA_DIR`, `S3_BUCKET`, `SECRET`, `SMTP_*` in a shared compose `.env`, …), set `SHELF_ALLOW_OLD_NAMES=1`. StoryShelf then starts, logs one warning naming the old variables it found (never their values), and still does not read them.
- The guard is temporary: it is removed in the first release of 2027. From then on the old names are simply ignored.
- `BUCKET_NAME` is not renamed: Fly's Tigris attachment (`fly storage create`) injects it beside `AWS_ENDPOINT_URL_S3` and the AWS keys, so StoryShelf still reads it as the S3 bucket when `SHELF_S3_BUCKET` is unset. Leave the secret your storage attachment manages in place.
- `storyshelf server init` and the Terraform modules write only the new names. A server you generated earlier keeps its own `process.env` reads; change them when you rename the variables.

To move, set every new name with the old value, unset the old names, then deploy the new release. In CI, rename the variable your workflow passes (`SHELF_TOKEN`, `SHELF_URL`); the repository secret behind it can keep its name.

| Old name                                                                                         | New name                                                                           |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `SECRET`                                                                                         | `SHELF_SECRET`                                                                     |
| `SECRET_PREVIOUS`                                                                                | `SHELF_SECRET_PREVIOUS`                                                            |
| `SECRET_MIGRATE`                                                                                 | `SHELF_SECRET_MIGRATE`                                                             |
| `ADMIN_TOKEN`, `STORYSHELF_ADMIN_TOKEN`                                                          | `SHELF_ADMIN_TOKEN`                                                                |
| `AUTH_PASSWORD`                                                                                  | `SHELF_ADMIN_PASSWORD`                                                             |
| `AUTH_EMAIL`                                                                                     | `SHELF_ADMIN_EMAIL`                                                                |
| `PUBLIC_BASE_URL`                                                                                | `SHELF_PUBLIC_BASE_URL`                                                            |
| `DATA_DIR`                                                                                       | `SHELF_DATA_DIR`                                                                   |
| `TRUST_PROXY`                                                                                    | `SHELF_TRUST_PROXY`                                                                |
| `LOG_LEVEL`                                                                                      | `SHELF_LOG_LEVEL`                                                                  |
| `CAPTURE_CONCURRENCY`, `STORYSHELF_CAPTURE_CONCURRENCY`                                          | `SHELF_CAPTURE_CONCURRENCY`                                                        |
| `PURGE_TTL_DAYS`                                                                                 | `SHELF_PURGE_TTL_DAYS`                                                             |
| `SHUTDOWN_GRACE_SECONDS`                                                                         | `SHELF_SHUTDOWN_GRACE_SECONDS`                                                     |
| `AWS_BUCKET`, `S3_BUCKET`                                                                        | `SHELF_S3_BUCKET`                                                                  |
| `GCS_BUCKET`                                                                                     | `SHELF_GCS_BUCKET`                                                                 |
| `AZURE_STORAGE_ACCOUNT`                                                                          | `SHELF_AZURE_ACCOUNT`                                                              |
| `AZURE_STORAGE_CONTAINER`                                                                        | `SHELF_AZURE_CONTAINER`                                                            |
| `AZURE_STORAGE_CONNECTION`                                                                       | `SHELF_AZURE_CONNECTION_STRING`                                                    |
| `DATABASE_CA`, `DATABASE_CA_FILE`                                                                | `SHELF_DATABASE_CA`, `SHELF_DATABASE_CA_FILE`                                      |
| `DATABASE_POOL_MAX`                                                                              | `SHELF_DATABASE_POOL_MAX`                                                          |
| `DATABASE_IAM_HOST`, `_USER`, `_NAME`, `_REGION`, `_PORT`                                        | `SHELF_DATABASE_IAM_HOST`, `_USER`, `_NAME`, `_REGION`, `_PORT`                    |
| `SMTP_HOST`, `_PORT`, `_SECURE`, `_USER`, `_PASS`, `_FROM`                                       | `SHELF_SMTP_HOST`, `_PORT`, `_SECURE`, `_USER`, `_PASS`, `_FROM`                   |
| `SES_REGION`, `SES_SMTP_USER`, `SES_SMTP_PASS`, `SES_FROM`                                       | `SHELF_SES_REGION`, `SHELF_SES_SMTP_USER`, `SHELF_SES_SMTP_PASS`, `SHELF_SES_FROM` |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`                                            | `SHELF_OIDC_ISSUER`, `SHELF_OIDC_CLIENT_ID`, `SHELF_OIDC_CLIENT_SECRET`            |
| `FIGMA_CLIENT_ID`, `FIGMA_CLIENT_SECRET`                                                         | `SHELF_FIGMA_CLIENT_ID`, `SHELF_FIGMA_CLIENT_SECRET`                               |
| `STORYSHELF_URL`, `STORYSHELF_HOST`                                                              | `SHELF_URL`                                                                        |
| `STORYSHELF_TOKEN`                                                                               | `SHELF_TOKEN` (already read before)                                                |
| `STORYSHELF_SLUG`                                                                                | `SHELF_SLUG`                                                                       |
| `STORYSHELF_FULL`, `STORYSHELF_ZIP`, `STORYSHELF_SKIP_UNCHANGED`                                 | `SHELF_FULL`, `SHELF_ZIP`, `SHELF_SKIP_UNCHANGED`                                  |
| `STORYSHELF_ALLOW_SERVERLESS`                                                                    | `SHELF_ALLOW_SERVERLESS`                                                           |
| `STORYSHELF_DIFF_WORKERS`, `STORYSHELF_IMAGE_ENGINE`                                             | `SHELF_DIFF_WORKERS`, `SHELF_IMAGE_ENGINE`                                         |
| `STORYSHELF_REUSE_PAGES`, `STORYSHELF_BROWSER_RECYCLE_EVERY`, `STORYSHELF_NAVIGATION_TIMEOUT_MS` | `SHELF_REUSE_PAGES`, `SHELF_BROWSER_RECYCLE_EVERY`, `SHELF_NAVIGATION_TIMEOUT_MS`  |
| `STORYSHELF_OTEL_ENABLED`, `STORYSHELF_OTEL_METRICS_INTERVAL_MS`                                 | `SHELF_OTEL_ENABLED`, `SHELF_OTEL_METRICS_INTERVAL_MS`                             |

### Nothing else is pending

Besides the runner, local storage and the variable names, no other breaking or changed entry is waiting in `.changeset/` today.

## 0.14.0 (2026-11-21)

### The compatibility packages are no longer published

**Who is affected:** a server (or a scaffold) whose `package.json` depends on `@storyshelf/notify-git`, `@storyshelf/notify-chat`, `@storyshelf/notify-email`, `@storyshelf/design-figma` or `@storyshelf/image`.

These five packages shipped in 0.13.0 as deprecated re-exports of code that now lives in `@storyshelf/core` ([ADR 0049](https://github.com/GuptaSiddhant/StoryShelf/blob/main/docs/adr/0049-built-in-integrations.md), section 8). 0.14.0 stops publishing them. The CLI also no longer counts a `@storyshelf/notify-git` dependency as a git channel; the built-in integrations are always registered.

1. Remove the five packages from your dependencies.
2. Import what you used from `@storyshelf/core` instead.
3. Delete `notifiers: [...chatNotifiers, ...gitNotifiers]` and `design: [createFigmaDesign()]` from your server options. Those lists replaced the built-ins, so leaving them in keeps working but pins the old behaviour. See [Choosing the providers](/guides/notifications/#choosing-the-providers).

### The server image starts only with sign-in configured

**Who is affected:** anyone who starts the server image without `AUTH_PASSWORD` and `SECRET`, or runs the dev or Fly server with `AUTH_PASSWORD` but no valid `SECRET` (they used to turn sign-in off; they now refuse to start).

Sign-in is now on by default and a missing variable never turns it off. The image refuses to start unless it has `AUTH_PASSWORD` and a `SECRET` of at least 32 characters, or `SHELF_AUTH=none`. `SHELF_AUTH=none` together with `AUTH_PASSWORD` is also refused. `createShelfAuth` refuses a `secret` that is unset or shorter than 32 characters, and refuses to start while `BETTER_AUTH_SECRETS` is set, because the auth library would sign with that instead of `SECRET`.

1. Set `AUTH_PASSWORD` and a `SECRET` of 32 characters or more in the image's environment ([Docker Compose settings](/guides/deployment/docker-compose/#settings)).
2. Or, for a deployment behind a VPN, set `SHELF_AUTH=none` on purpose. Every route is then open and the image logs a warning ([Auth](/guides/deployment/docker-compose/#auth)).
3. If you set `BETTER_AUTH_SECRETS` in your own server, unset it.

### `@storyshelf/runner-puppeteer` needs `puppeteer-core` 25 and is deprecated

**Who is affected:** a server that uses the Puppeteer runner.

The runner now requires `puppeteer-core` `^25` (it was `^24`) and passes remote-connection headers as `wsOptions.headers`. Puppeteer 24 is no longer supported. The runner is also deprecated in this release: it logs one warning when the host binds its logger, gets fixes only, and is removed in [0.15.0](#nothing-else-is-pending).

1. Either install `puppeteer-core@^25` next to the runner to stay on it for now, or
2. switch to Playwright now, following [Switching from Puppeteer to Playwright](#switching-from-puppeteer-to-playwright). That section also covers the one new baseline you should expect.

### Git connections are set up by the operator

**Who is affected:** anyone who posts git statuses or a pull-request comment. **No action is required**: per-project git channels keep working unchanged.

This release adds a second way to connect a git host ([ADR 0054](https://github.com/GuptaSiddhant/StoryShelf/blob/main/docs/adr/0054-operator-git-connections.md), epic #1117). A site admin connects GitHub or GitLab once on **System → Git** (or the operator declares the connection in configuration: `SHELF_GITHUB_APP_ID`, `SHELF_GITLAB_TOKEN` and the others in [Server-wide connection from configuration](/guides/merge-gate/#server-wide-connection-from-configuration)), and a project then links a repository on **Project → Settings → Git**. A link waits as _pending_ until a site admin approves it (it is approved at once when the operator switch is on).

What happens to what you already have:

- **Existing git channels are not migrated, converted or removed.** They keep their token or App key and keep posting the same status names. The git channel form on **Project → Settings → Notifications** is unchanged.
- **A repository and status prefix can be used once.** The uniqueness check for links also counts per-project channels, so a link with the same repository and prefix as an existing channel is refused until you remove the channel or choose another prefix.
- **Delivery through a link uses the connection's credentials**, never a channel secret. The connection's ceiling limits what a link may post, and the merge gate always posts.

To move a project from a channel to a link, connect the host on **System → Git**, delete the old channel (or give the link a different prefix), link the repository, and wait for approval until the link shows _Connected_. The required check names do not change, so branch protection stays as it is ([Merge gate](/guides/merge-gate/#upgrading)).

### One pull-request comment per project

**Who is affected:** anyone with the pull-request comment on. **No action is required.**

The comment is now keyed by project instead of build, so ten pushes rewrite one comment, and it is found beyond the first 100 comments of a busy pull request. The old per-build marker is still read, so an open pull request adopts its existing comment. The comment goes only to an open pull request, never to the merged one that holds a default-branch commit, and it leads with one state and a table of changed stories.

### The email notifier waits for a transport

**Who is affected:** projects with an email notification channel.

A provider may now declare that it is unavailable. The built-in email notifier is unavailable until a transport replaces it. A stored channel of an unavailable kind is kept, but it is hidden from its project and not delivered to, and creating one answers `400` with the reason. The **System** page lists every integration's state, and `POST /api/v1/health` (site admins) reports the same under `integrations`.

1. Set `SMTP_HOST` and `SMTP_FROM` (and `npm install nodemailer` for SMTP), or pass your own sender ([Choosing the providers](/guides/notifications/#choosing-the-providers)).
2. Optionally turn kinds off with `SHELF_INTEGRATIONS_DISABLED`, for example `slack,teams,figma`. An unknown kind stops startup.

### `storyshelf upload` prints phases and a summary

**Who is affected:** CI scripts that read the output of `storyshelf upload`.

`upload`, `doctor` and `server init` now open each phase with `==> Checking config` and close it with `--> Checked config (0.4s)`. Phase and progress lines go to stderr and results stay on stdout. When stderr is not a terminal, or `CI` is set, there is no spinner and no progress bar: one line opens and one closes each phase. Exit codes are unchanged.

The upload ends with a `Summary` block (files, size, stories, then a `Build:` row, a `Time:` row and the build link):

```text
Summary
  Files:    860
  Size:     18.3 MiB
  Stories:  12 of 860 affected
  Build:    01J…
  Time:     41.2s
View the build: https://shelf.example.com/…
```

- **`Build created: <id>` is gone from a current server.** The last line is now `View the build: <url>`. The old line appears only when the server predates the `buildUrl` field in the create-build answer. A script that greps for `Build created:` finds nothing against a current server.
- **Read the id with `--json`.** `storyshelf upload --json` prints `{ "buildId", "url", "status", "skipped" }` on stdout and every other message on stderr, so `npx storyshelf upload … --json | jq -r .buildId` replaces the grep. On GitHub Actions the upload step also sets the `build-id` and `build-url` outputs, so a later step reads `steps.<id>.outputs.build-id`. See [Machine-readable output](/guides/cli/client/#machine-readable-output).
- **On 0.14.0 and earlier there is no `--json`.** Match the `Build:` row instead, for example `grep -oE '^ *Build: +[0-9A-Z]{26}'`, or use `--wait` and its exit codes (next section) when all you need is the verdict.

### `storyshelf upload --wait` follows the build

**Who is affected:** CI jobs that want to gate on the result without the git integration. Opt-in: nothing changes unless you pass `--wait`.

After the upload, `--wait` polls the build and exits by how it ended. It never waits for a person, so a build that needs review ends the wait.

| Exit | Meaning                                                                                       |
| ---- | --------------------------------------------------------------------------------------------- |
| `0`  | Approved (including no changes, a skipped build, or a hosting-only build accepted on publish) |
| `2`  | Changes need review, or the Storybook is published and waits for a verdict                    |
| `3`  | Rejected                                                                                      |
| `4`  | Failed (including a failing Storybook test)                                                   |
| `5`  | Cancelled, including superseded by a newer build                                              |
| `6`  | `--timeout` reached (default 30 minutes) while the build still ran. Nothing is cancelled      |
| `1`  | The CLI itself failed (config, network, auth, the upload)                                     |

A CI step fails on any non-zero exit, so decide what `2` should mean for your pipeline. See [Gating CI with `--wait`](/guides/cli/client/#gating-ci-with---wait).

### Purge and branch cleanup on MySQL 8

**Who is affected:** a MySQL 8 database with testing on that is shared by more than one instance.

`createMysqlDatabase` on a connection pool now implements the fenced retention lifecycle ([ADR 0039](https://github.com/GuptaSiddhant/StoryShelf/blob/main/docs/adr/0039-build-retention-lifecycle.md)), so build purge and branch GC work. At boot it checks the server (MySQL 8, InnoDB lifecycle tables, binary log not `STATEMENT`) and pins every baseline's source build before it turns retention on. The schema changes are additive, so 0.13 can still run on them.

1. **Upgrade every instance that shares the database before you rely on purge.** An older instance writes baselines without the fence.
2. PlanetScale and TiDB presets, an injected single `Connection`, MariaDB, Vitess and other MySQL versions stay fail closed, and the server logs why once at boot.

### Smaller changes worth knowing

- **`storyshelf create`** on a server with sign-in on creates the project but no longer mints a token that cannot upload. It prints the project's page, where **Get your first build** creates one.
- **`SHELF_STORYBOOK_HOSTING=sandboxed`** is available to the image. Unset or `trusted` keeps today's behaviour; any other value stops boot. See [Security](/guides/security/).
- **Times in the app** render in UTC and English, not in the server's time zone.
- **`@storyshelf/storage-local` is deprecated.** Local storage is built into core: import `createLocalStorage` from `@storyshelf/core/storage/local` and drop the package. (0.15.0 removes the package; see [`@storyshelf/storage-local` is removed](#storyshelfstorage-local-is-removed).)

## Related

- [Changelog](/changelog/): every change, release by release.
- [Upgrading and support](/guides/support/): what a release promises, rollback and where to ask.
- [Troubleshooting & FAQ](/guides/troubleshooting/).
