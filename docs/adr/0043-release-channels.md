# ADR 0043: Release Channels

## Status

Accepted (owner decisions, 2026-11-02; stable releases by pull request, 2026-11-03). Implemented by #473. It replaces the stopgap that published a
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
4. **Stable channel, by release pull request.** There is no standing version pull request and no
   tag pushed by hand. When the owner asks, `nub run release:prepare` (`scripts/release.mjs`) runs
   `changeset version` on a new branch `release/v<version>`: one version for every package, the
   `CHANGELOG.md` section, the consumed changesets deleted, one commit `chore(release): v<version>`.
   It fails when no changeset is pending. The pull request goes through normal review and CI, so no
   ruleset bypass is needed. On the push to `main`, the `detect` job of `release.yml` reads the shared
   version: if it is not a prerelease and tag `v<version>` does not exist, the same run validates,
   publishes `latest` to npm and JSR, creates the tag through the API with `GITHUB_TOKEN`, then the
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
- **Re-running.** `scripts/publish-npm.mjs` and `scripts/publish-jsr.mjs` skip versions already on
  their registry; the tag and the GitHub Release creation tolerate "already exists" (an existing tag
  is kept, even at another commit). A JSR failure does not stop the tag or the release
  (`continue-on-error`); re-run to publish what JSR lacks. Every stable job checks out, publishes and
  tags the release commit (the merged `chore(release): v<version>` commit, found by `detect`), not the
  tip of `main`, so a retry after later merges still ships the original tree.
- **Verification.** The release pull request is verified by CI like any other, and
  `release:prepare` runs `release-validate.mjs` and `nub publish -r --dry-run` before it commits.
  The publish run validates the fixed versions again and builds before it publishes.
- **Owner setup, once.** Create the `no-release` label, and confirm the npm trusted publishers do not
  restrict the workflow to tag refs, since the release now runs on pushes to `main`.

## Consequences

- Contributors write the changelog entry in the pull request that makes the change. `CHANGELOG.md` is
  no longer edited by hand.
- Every merged change with a changeset is installable from npm as `@storyshelf/*@next`. A stable
  version is a deliberate act with a dry run.
- The choice of bump (patch, minor, major) is made per changeset and applies to the whole fixed group.

## Alternatives considered

| Option                            | Why not                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| A "Version Packages" pull request | A standing bot pull request: the owner wants a release pull request only on request.                   |
| Release by `workflow_dispatch`    | Pushed the release commit and tag to `main` from CI, which needs a ruleset bypass; no review step.     |
| Publish every push to `main`      | Docs, test and CI merges would publish identical builds; the changeset is what marks a shipped change. |
| `0.0.0-<sha>` snapshot versions   | They do not say which release is coming; `useCalculatedVersion` gives `0.9.0-next-<sha>`.              |
| Publish from a new workflow file  | The npm trusted publisher is registered to `release.yml`.                                              |
