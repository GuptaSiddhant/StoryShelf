---
title: Upgrading and support
description: What every release promises about upgrades, rollbacks, breaking changes and security fixes, which setups are supported, and where to ask for help.
---

## What a release promises

1. **Upgrades happen in place.** Every release upgrades in place from the previous minor, and rolling back one release is supported. The schema changes of a release never break the one before it ([ADR 0053](https://github.com/GuptaSiddhant/StoryShelf/blob/main/docs/adr/0053-migrations-keep-previous-release-working.md)). To skip minors, stop every copy first, then start the new release.
2. **Breaking changes ship only in a minor.** Each appears under **Breaking** in the release notes (the [changelog](/changelog/)). A patch release never breaks anything. There is no 1.0 yet, so a minor can break; read the notes before you upgrade.
3. **Security fixes go to the latest release.** Upgrade before reporting an issue you found on an older release. See the [security policy](https://github.com/GuptaSiddhant/StoryShelf/blob/main/SECURITY.md).
4. **Releases are weekly.**

## Supported at launch

| Area           | Supported                                                     | Preview          |
| -------------- | ------------------------------------------------------------- | ---------------- |
| Database       | SQLite, Postgres                                              | MySQL            |
| How you run it | The Docker image, the npm scaffold (`storyshelf server init`) | Terraform stacks |

A preview works and is documented, but may change between releases and gets fixes after the supported setups.

## Upgrading

1. Read the notes for every release between yours and the latest, looking at **Breaking** first.
2. Back up the database and the storage.
3. Start the new image or run `npm update` in the scaffold, then restart. The server migrates the schema at boot.
4. Run `npx storyshelf doctor` and check the System page.

To roll back one release, start the previous image or version against the same database. Do not roll back further than one release.

## Switching from Puppeteer to Playwright

`@storyshelf/runner-puppeteer` was deprecated in 0.14.0 and is removed in 0.15.0. Playwright is the one capture runner.

1. Install `@storyshelf/runner-playwright`, run `playwright install chromium` (or use an image that has it) and remove `@storyshelf/runner-puppeteer`.
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

## Getting help

- **Question or idea:** open a thread in [GitHub Discussions](https://github.com/GuptaSiddhant/StoryShelf/discussions) (Q&A for questions, Ideas for requests). Try [Troubleshooting & FAQ](/guides/troubleshooting/) first.
- **Bug:** file the [bug form](https://github.com/GuptaSiddhant/StoryShelf/issues/new?template=bug-report.yml). It asks for your version, install path, database and storage, host, `storyshelf doctor` output and logs. Include the `x-request-id` response header of a failing request when you have it.
- **Security vulnerability:** report it privately through the [advisory form](https://github.com/GuptaSiddhant/StoryShelf/security/advisories/new). Do not open a public issue.
