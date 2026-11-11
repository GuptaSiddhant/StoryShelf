# ADR 0043: Release Channels

## Status

Accepted (owner decisions, 2026-11-02; stable releases by pull request, 2026-11-03; release cadence and no v1 yet, 2026-11-09). Implemented by #473. It replaces the stopgap that published a
pkg.pr.new preview for every push to `main`.

## Context

Releases were cut by hand: `scripts/release.mjs <bump>` bumped the fixed version, a tag push ran
`release.yml`, and `CHANGELOG.md` was edited by hand under `## Unreleased`. Nothing said which merged
change was meant to ship, and `main` could not be consumed between releases except through preview
URLs that npm clients cannot depend on durably.

## Decision

1. **Changesets decides what releases.** A pull request that changes shipped behavior adds a
   `.changeset/*.md` file (`nub run changeset <patch|minor|major>`). Docs, test, CI and typo pull requests add none and release
   nothing.
2. **One shared version.** All published packages (22 today) keep one version, raised by the largest
   bump of all pending changesets. `scripts/release-validate.mjs` keeps enforcing it.
3. **`next` channel, daily** (amended 2026-11-07, see below). A push to `main` that has pending changesets publishes a snapshot
   of every package to npm under the **`next`** dist-tag, versioned `<calculated next
   version>-next-<short sha>` (for example `0.9.0-next-3fa9c1d`). The snapshot is made in the CI
   working tree and never committed. npm only. A push without a pending
   changeset publishes nothing, and `latest` is never touched.
4. **Stable channel, by release pull request.** There is no standing version pull request and no
   tag pushed by hand. When the owner asks, `nub run release:prepare` (`scripts/release.mjs`) runs
   `scripts/version-packages.mjs` on a new branch `release/v<version>`: one version for every package, the
   `CHANGELOG.md` section, the consumed changesets deleted, one commit `chore(release): v<version>`.
   It fails when no changeset is pending. The pull request goes through normal review and CI, so no
   ruleset bypass is needed. On the push to `main`, the `detect` job of `release.yml` reads the shared
   version: if it is not a prerelease and tag `v<version>` does not exist, the same run validates,
   publishes `latest` to npm, creates the tag through the API with `GITHUB_TOKEN`, then the
   GitHub Release from `CHANGELOG.md`. Otherwise it takes the `next` path when changesets are pending,
   and does nothing when they are not. The tag is created after npm succeeds and is what marks the
   version released, so a failed publish is retried by the next push to `main`, or by
   `workflow_dispatch` (input: the version), which re-runs only what is missing. The `v*` tag trigger
   is removed.
5. **All npm publishing stays in `.github/workflows/release.yml`.** The npm trusted publisher of every
   package is registered to that file name. The workflow gains a `push: main` trigger, and each job is
   gated by event and ref. No other workflow publishes to npm, and publishing is not moved into a
   reusable workflow without first confirming against npm's documentation that the publisher still
   matches.
6. **One root `CHANGELOG.md`.** There are no per-package changelogs.
   `scripts/version-packages.mjs` renders the consumed changesets into a section of the root file,
   largest bump first, so `scripts/release-notes.mjs` keeps working. A section already written for the
   calculated version is extended, not duplicated. The hand-written `## Unreleased` prose that existed
   before Changesets is released under the first Changesets version, and the heading is removed.
7. **A changeset check in CI.** A pull request into `main` or `epic/**` that changes
   `packages/*/src/**` (test files and test helpers excluded) or a published `package.json` must add
   a changeset, unless it carries the **`no-release`** label. Task pull requests on an epic branch add
   their changesets there; they reach `main` with the epic, so an epic produces one `next` build.
8. **Package previews only on epic branches.** `release-preview.yml` runs on `push` to `epic/**`
   and no longer on `main`, where the `next` channel replaces it.

## Amendment, 2026-11-03 (#500)

The Changesets file format stays; the Changesets CLI is gone. `scripts/version-packages.mjs` does the
versioning itself (largest bump over the pending files, one shared version, the root `CHANGELOG.md`
section, the consumed files deleted, and `--snapshot` for the `next` build), and `nub run changeset`
writes a file. The CLI was removed because nub is not a workspace it can detect: it needed a
`lerna.json` shim and `.changeset/config.json`, and added a dependency tree to `nub.lock`. A release
pull request (head branch `release/v<version>`, changing only package versions, `CHANGELOG.md` and
deleted changesets) passes the changeset check without a changeset; any other change on that branch
fails it, so the branch name cannot skip the check.

## Amendment, 2026-11-07 (#789)

Decision 3 is narrowed: a push to `main` no longer publishes `next`, because every merged package
change produced its own snapshot and most were superseded within hours. `release.yml` gains a daily
`schedule` run that publishes `next` only while changesets are pending and a package, changeset,
root `package.json` or `nub.lock` changed since the commit of the current `@storyshelf/core@next`
(read from its `-next-<sha>` suffix; anything `detect` cannot establish counts as changed). A
`workflow_dispatch` with channel `next` publishes one immediately. The push trigger keeps the stable
path, and the daily run also retries an untagged stable version. The shared publish steps move into
the composite action `.github/actions/npm-publish`, which runs inside the `release.yml` jobs, so the
OIDC token and the trusted publisher still name `release.yml` (decision 5); it is used nowhere else.

## Amendment, 2026-11-09 (release cadence)

Decision 4 gains a schedule. The release pull request is no longer opened only when the owner asks:
`release-pr.yml` opens it when `scripts/release-due.mjs` says a release is due, and only the owner
merges it, as before.

- **A P0 is released.** Merging a pull request labelled `p0-critical` into `main` opens a release.
- **An epic is released.** Merging an `epic/…` branch into `main` opens a release.
- **Standalones are released weekly.** The daily run opens a release once the last minor release
  (`vX.Y.0`) is 7 or more days old.
- **Guards.** Nothing opens without pending changesets or while a `release/v*` pull request is open.
  The bump, minor or patch, always comes from the changesets, never from the trigger.
- **No v1 yet.** There is no 1.0 until the owner has dogfood proof that everything works. Until then
  a breaking change is a `minor`: the changeset check refuses a `major` changeset, and
  `bumpVersion` refuses to cross 1.0. Lifting this is an owner decision recorded here.

Work that changes behaviour across several pull requests lands on an epic branch, so `main` never
ships half of a feature in a weekly release (AGENTS.md "Epic branches").

## Amendment, 2026-11-09 (short release notes)

The v0.10.0 release notes ran to 48 KB: 96 paragraph-long entries, many of them internal (stories,
tests, adapter groundwork), and decision 6's minor-release roll-up repeated all of 0.9.0 below them.
The owner asked for short notes, with the detail kept in `CHANGELOG.md`.

- **Every changeset leads with a summary.** Its body starts with one line `<Kind>: <summary>`, at
  most 100 characters, then a blank line and the details. Kind is one of `Breaking`, `Added`,
  `Changed`, `Fixed`, `Security` or `Internal` (stories, tests, groundwork a user does not see).
  The changeset check and `nub run changeset --message` refuse anything else
  (`scripts/changelog-entry.mjs`).
- **`CHANGELOG.md` is grouped.** A release section has one `### <Kind>` block per kind, each entry a
  bullet with its summary and its details indented below it. Older sections are left as written.
- **The GitHub Release is short.** `scripts/release-notes.mjs` prints the section's summaries by
  kind without details, counts the internal entries instead of listing them, and links the full
  section and the diff from the previous release. The roll-up of the previous minor line is
  dropped: with a release every week each version's own notes are enough.

## Amendment, 2026-11-10 (website and demo follow releases)

The owner decided that readers and demo visitors see only released behaviour.

- **Website** (the `/next/` part was dropped on 2026-11-11, see below).
  - `/` is built from the latest stable release tag. `/next/` is built from `main`, carries an
    "unreleased" banner and is kept out of search engines (`noindex`, canonical links to stable).
  - One Pages workflow builds both, with separate search indexes, on every push to `main` and every
    stable release. A version switcher links the two.
  - There are no per-release archives before 1.0. After 1.0, one copy is kept per major version.
  - A docs-only fix reaches `/` with the next release, or a P0 patch release when urgent.
- **Fly demo.** It deploys only after a stable release publishes, from that release's tag. Once the
  official image exists (#887), it runs that image at the released version.
  - There is no `next` demo for now. The owner may host one on another cloud later.
  - The app's own Storybook upload (`app-storybook.yml`) still runs on every push to `main`: it uses
    the demo as a CI tool, not as release documentation.

## Amendment, 2026-11-11 (next by hand, previews of main, stable-only docs)

The owner decided that weekly and P0 releases make a daily `next` build unnecessary.

- **`next` only by hand.** Decision 3 changes: `release.yml` has no schedule, and a `next` build is
  published only by a `workflow_dispatch` with channel `next` while changesets are pending. Use it,
  for example, before a breaking minor so early users can install `@next`.
- **`main` is previewed, not published.** Decision 8 changes: `release-preview.yml` also runs on
  pushes to `main` that change a package, so `main` installs from pkg.pr.new (`@main` or a commit)
  and adds nothing to npm.
- **The website has one version.** The 2026-11-10 `/next/` build is dropped: `main` is not something
  users install, so docs for it would describe what nobody can run. The website is built from the
  latest stable release tag only, and deployed after each stable release.

## Operations

- **Re-running.** `scripts/publish-npm.mjs` skips versions already on npm; the tag and the GitHub
  Release creation tolerate "already exists" (an existing tag is kept, even at another commit).
  Every stable job checks out, publishes and tags the release commit (the merged `chore(release): v<version>` commit, found by `detect`), not the
  tip of `main`, so a retry after later merges still ships the original tree.
- **Verification.** The release pull request is verified by CI like any other, and
  `release:prepare` runs `release-validate.mjs` and `nub publish -r --dry-run` before it commits.
  The publish run validates the fixed versions again and builds before it publishes.
- **Owner setup, once.** Create the `no-release` label, and confirm the npm trusted publishers do not
  restrict the workflow to tag refs, since the release now runs on pushes to `main`.

## Consequences

- Contributors write the changelog entry in the pull request that makes the change. `CHANGELOG.md` is
  no longer edited by hand.
- Every merged change with a changeset is installable from npm as `@storyshelf/*@next` within a day. A stable
  version is a deliberate act with a dry run.
- The choice of bump (patch, minor, major) is made per changeset and applies to the whole fixed group.

## Alternatives considered

| Option                            | Why not                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| A "Version Packages" pull request | A standing bot pull request: the owner wants a release pull request only on request.                   |
| Release by `workflow_dispatch`    | Pushed the release commit and tag to `main` from CI, which needs a ruleset bypass; no review step.     |
| Publish every push to `main`      | Docs, test and CI merges would publish identical builds; the changeset is what marks a shipped change. |
| `0.0.0-<sha>` snapshot versions   | They do not say which release is coming; the calculated version gives `0.9.0-next-<sha>`.              |
| Publish from a new workflow file  | The npm trusted publisher is registered to `release.yml`.                                              |
