---
title: Upgrading guide
description: Every change in 0.14 and 0.15 that needs action from you, with who is affected and the exact steps. Start here when you move from 0.13 or 0.14.
---

This page lists the changes that need something from you, one section per release, newest first. Nothing here replaces the [changelog](/changelog/), which lists every change. For what every release promises (in-place upgrades, one release of rollback, breaking changes only in a minor), see [Upgrading and support](/guides/support/#what-a-release-promises).

Before any upgrade, [back up](/guides/backup-restore/) the database and the storage, then follow the steps in [Upgrading and support](/guides/support/#upgrading). Coming from 0.12 or older? Read the changelog for each release in between as well.

## 0.15.0 (in progress)

0.15.0 is not released yet. This section lists what is already decided and will change as the release firms up.

### `@storyshelf/runner-puppeteer` is removed

**Who is affected:** a server that builds its capture runner with `createPuppeteerCaptureRunner` from `@storyshelf/runner-puppeteer`. If you use `@storyshelf/runner-playwright`, nothing changes.

0.14.0 deprecated the package and 0.15.0 removes it ([ADR 0001](https://github.com/GuptaSiddhant/StoryShelf/blob/main/docs/adr/0001-architecture-and-conventions.md), amendment 2026-11-20). Switch to the Playwright runner while you are still on 0.14.x, then upgrade. The steps, the option mapping and the note about the new baseline are in [Switching from Puppeteer to Playwright](/packages/runner-puppeteer/#switching-from-puppeteer-to-playwright).

### Nothing else is pending

Besides the runner, no other breaking or changed entry is waiting in `.changeset/` today.

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
2. switch to Playwright now, following [Switching from Puppeteer to Playwright](/packages/runner-puppeteer/#switching-from-puppeteer-to-playwright). That section also covers the one new baseline you should expect.

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
- **Read the id from the `Build:` row.** For example `grep -oE '^ *Build: +[0-9A-Z]{26}'`, as the repository's own [Storybook upload workflow](https://github.com/GuptaSiddhant/StoryShelf/blob/main/.github/workflows/app-storybook.yml) does.
- **There is no `--json` option in 0.14.0.** Until one ships, match the `Build:` row, or use `--wait` and its exit codes (next section) when all you need is the verdict.

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
- **A scaffold from an older `server init`** that fails with `ERR_MODULE_NOT_FOUND` for `@storyshelf/storage-local` needs that package added to its `package.json`.

## Related

- [Changelog](/changelog/): every change, release by release.
- [Upgrading and support](/guides/support/): what a release promises, rollback and where to ask.
- [Troubleshooting & FAQ](/guides/troubleshooting/).
