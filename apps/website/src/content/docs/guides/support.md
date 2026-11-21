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
| How you run it | The Docker image, the npm scaffold (`storyshelf server init`) | The Terraform modules (AWS, GCP, Azure) |

A preview works and is documented, but may change between releases and gets fixes after the supported setups.

## Upgrading

1. Read the notes for every release between yours and the latest, looking at **Breaking** first.
2. Back up the database and the storage.
3. Start the new image or run `npm update` in the scaffold, then restart. The server migrates the schema at boot.
4. Run `npx storyshelf doctor` and check the System page.

To roll back one release, start the previous image or version against the same database. Do not roll back further than one release.

## Getting help

- **Question or idea:** open a thread in [GitHub Discussions](https://github.com/GuptaSiddhant/StoryShelf/discussions) (Q&A for questions, Ideas for requests). Try [Troubleshooting & FAQ](/guides/troubleshooting/) first.
- **Bug:** file the [bug form](https://github.com/GuptaSiddhant/StoryShelf/issues/new?template=bug-report.yml). It asks for your version, install path, database and storage, host, `storyshelf doctor` output and logs. Include the `x-request-id` response header of a failing request when you have it.
- **Security vulnerability:** report it privately through the [advisory form](https://github.com/GuptaSiddhant/StoryShelf/security/advisories/new). Do not open a public issue.
