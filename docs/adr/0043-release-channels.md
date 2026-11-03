# ADR 0043: Release Channels

## Status

Accepted (owner decision, 2026-11-02). Implemented by #473. It replaces the stopgap that published a
pkg.pr.new preview for every push to `main`.

## Context

Releases were cut by hand: `scripts/release.mjs <bump>` bumped the fixed version, a tag push ran
`release.yml`, and `CHANGELOG.md` was edited by hand under `## Unreleased`. Nothing said which merged
change was meant to ship, and `main` could not be consumed between releases except through preview
URLs that npm clients cannot depend on durably.

## Decision

1. **Changesets decides what releases.** A pull request that changes shipped behavior adds a
   `.changeset/*.md` file (`nubx changeset`). Docs, test, CI and typo pull requests add none and release
   nothing.
2. **One shared version.** All published packages (22 today) keep one version: a Changesets `fixed`
   group. `scripts/release-validate.mjs` keeps enforcing it, and also that every `deno.json` matches.
3. **`next` channel, continuous.** A push to `main` that has pending changesets publishes a snapshot
   of every package to npm under the **`next`** dist-tag, versioned `<calculated next
version>-next-<short sha>` (for example `0.9.0-next-3fa9c1d`). The snapshot is made in the CI
   working tree and never committed. npm only: JSR has no dist-tags. A push without a pending
   changeset publishes nothing, and `latest` is never touched.
4. **Stable channel, manual.** There is no version pull request. A stable release happens only when
   the owner asks, as a `workflow_dispatch` of `release.yml` (inputs `confirm: release` and
   `dry_run`). One run versions from the pending changesets, commits `chore(release): v<version>` to
   `main`, tags `v<version>`, pushes both, then publishes to `latest` on npm and JSR and creates the
   GitHub Release from `CHANGELOG.md`. Tag and publish happen in the same run because a tag pushed
   with the default token does not start another workflow. `dry_run` does everything except push and
   publish. The `v*` tag trigger stays as the emergency path, and `scripts/release.mjs` with no bump
   argument does the same versioning from a workstation.
5. **All npm publishing stays in `.github/workflows/release.yml`.** The npm trusted publisher of every
   package is registered to that file name. The workflow gains a `push: main` trigger, and each job is
   gated by event and ref. No other workflow publishes to npm, and publishing is not moved into a
   reusable workflow without first confirming against npm's documentation that the publisher still
   matches.
6. **One root `CHANGELOG.md`.** Per-package changelogs are off (`changelog: false`).
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

## Operations

- **Workspace detection.** Changesets recognises a monorepo only by a package manager's lockfile or a
  `lerna.json`, and nub's `nub.lock` is neither. The root `lerna.json` (`packages/*`) exists for that
  reason alone; nothing else reads it.
- **Re-running.** `scripts/publish-npm.mjs` skips versions already on npm, so a failed publish can be
  re-run. A failed `prepare` job before its push leaves no tag. Its push is a plain one: if `main`
  moved during the run it is refused and nothing is published.
- **Verification.** The release commit is not re-verified in the run (`--skip-verify`): `main` already
  passed CI. `scripts/release.mjs` still runs `nub publish -r --dry-run` before it commits.
- **Owner setup, once.** Let the release run push to `main` (add GitHub Actions as a bypass actor on
  the `main` ruleset, or provide an App token), create the `no-release` label, and confirm the npm
  trusted publishers do not restrict the workflow to tag refs, since `next` publishes from `main`.

## Consequences

- Contributors write the changelog entry in the pull request that makes the change. `CHANGELOG.md` is
  no longer edited by hand.
- Every merged change with a changeset is installable from npm as `@storyshelf/*@next`. A stable
  version is a deliberate act with a dry run.
- The choice of bump (patch, minor, major) is made per changeset and applies to the whole fixed group.

## Alternatives considered

| Option                            | Why not                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| A "Version Packages" pull request | The owner wants stable releases only on request, not a standing pull request.                          |
| Publish every push to `main`      | Docs, test and CI merges would publish identical builds; the changeset is what marks a shipped change. |
| `0.0.0-<sha>` snapshot versions   | They do not say which release is coming; `useCalculatedVersion` gives `0.9.0-next-<sha>`.              |
| Publish from a new workflow file  | The npm trusted publisher is registered to `release.yml`.                                              |
