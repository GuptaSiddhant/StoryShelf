# ADR 0045: Cancel Superseded Builds on a Branch

## Status

Accepted (owner, 2026-11-07; proposed by the architect, 2026-11-04; on by default). Amends ADR 0004 (affected
capture), ADR 0006 (cancellation) and ADR 0014 (git state). Implementation is split into issues
listed under "Delivery". Depends on #757.

## Context

Every upload captures to the end. Three quick pushes to a branch, or a force push over earlier
commits, start three captures, and the older two only cost runner time: nobody reviews a commit
that is no longer the head of its branch. A CI concurrency group with `cancel-in-progress` stops
uploads that have not happened yet, but once a Storybook is uploaded, capture runs on the server
whatever happens in CI.

Two traps decide the design:

- **Order is not history.** A re-run of CI on an old commit uploads after a newer one. Cancelling
  "every earlier build on the branch" would then cancel the newest commit's build. Only git history
  says which commit replaces which, and only the CLI has it.
- **A cancelled predecessor must not become the comparison commit.** Affected capture inherits every
  story it does not render from the baselines. Comparing against a build whose changes never reached
  the baselines hides those changes. That is a bug today for cancelled, failed and unapproved
  predecessors, and #757 fixes it: the comparison commit is the newest **approved** build on the
  branch. Cancelling superseded builds by default would make that case common, so it lands after
  #757.

## Decision

1. **A project setting, `projects.cancel_superseded`, on by default.** Project admins change it in
   project settings. It is a column with default `true`, so existing projects get it on upgrade, and
   the changeset says so. There is no `ShelfOptions` field, as with `review_enabled`.
2. **The CLI proposes; the server decides.**
   - When creating a build (or a skipped build, ADR 0044), the CLI first asks for the branch's
     in-flight builds: `GET /api/v1/projects/:slug/builds/in-flight?branch=`, which answers
     `{ id, sha }[]` for builds in `CANCELLABLE_BUILD_STATUSES`.
   - For each one, the CLI checks local history. A build of the **same commit** as `HEAD` is always
     kept (`--is-ancestor` also succeeds for equal commits, and both builds post to the same
     `(sha, context)` status). Otherwise the build is **superseded** when its commit is a strict
     ancestor of `HEAD` (`git merge-base --is-ancestor`, a normal push). It is also superseded when
     its commit is missing locally **and** `HEAD` is the branch's current tip on the remote
     (`git ls-remote origin refs/heads/<branch>` answers `HEAD`), because then nothing newer exists
     and the commit was force-pushed away. A clone that predates a newer push fails that check.
   - It is **kept** in every other case: a descendant of `HEAD` (a re-run of an old commit), a
     missing commit when the remote tip is not `HEAD` or cannot be read, or any git error.
   - The CLI sends the superseded ids as `supersedes: string[]` on build creation. It always sends
     them; the server ignores them when the setting is off.
3. **The server checks each id before cancelling.** It must be in the same project and branch, of a
   different commit, in a cancellable status at that moment, and created before the new build.
   Anything else is ignored, never an error. The ids are stored with the new build and acted on
   only once the replacement is **viable**: its upload is accepted and published (the
   `PublishCompleter.complete` success path), or, for a skipped build (ADR 0044), at creation. An
   upload that never completes cancels nothing. A failure to cancel never fails the upload.
   **Fenced against completion.** `BuildModel.supersede` moves the status with one conditional
   write (`cancelled` only where the status is still cancellable, setting `superseded_by_build_id`
   in the same statement); when it changes no row, the build finished first and is left alone.
   Only after a row changed does it call the queue's `cancel(buildId)` and
   `announceBuildStatus(id, "cancelled")`, the existing path, so a build cannot reach `reviewing`
   and still be cancelled.
4. **Only builds still working are cancelled.** A build in `reviewing` or later has snapshots,
   comments or verdicts that people may be using. It is never cancelled this way, whatever the
   setting. The same holds for any build that is already published and waiting for verdicts with
   testing off (still `pending`, ADR 0006), and for any build with a comment or a verdict: status
   alone is not enough, so `supersede` checks publishing and `build_reviews`/comments too.
5. **A superseded build records why.** The new column `builds.superseded_by_build_id` is nullable
   text, set in the same write that cancels. The build stays `cancelled`; there is no new status, so
   every rule about `cancelled` (ADR 0006, AGENTS.md) holds unchanged.
6. **What the status says** (ADR 0014; one new case in `statusesForBuild`, no call-site status). A
   superseded build keeps the `cancelled` outcome with the description `Superseded by <short sha>`,
   and the pull-request comment links the newer build. The host state is the existing cancelled
   mapping (GitHub `error`, GitLab `canceled`). The pull request's required check follows its head
   commit, which is the newer build.
7. **The default branch is included.** After #757, the next build on the default branch compares
   against the newest approved build, so a cancelled one leaves no gap.
8. **UI.** The settings page has the toggle (a `Field` with a short explanation). A superseded
   build's page shows "Superseded by" with a link, instead of the plain cancelled notice. The builds
   list shows it as cancelled.

## Schema

`projects.cancel_superseded` (boolean, not null, default `true`), `builds.superseded_by_build_id`
(nullable text) and `builds.supersedes` (nullable JSON text: the ids proposed at creation, acted on
when the build becomes viable), in every dialect's DDL, Drizzle schema and migration, plus the core row types (ADR
0041 is still proposed).

## Consequences

- Fast pushes and force pushes cost one capture, not one per commit.
- A missing commit is judged only by the remote-tip check, never by clone depth: when `HEAD` is the
  branch's current tip, every other commit built on the branch is either older history or
  force-pushed away, so a shallow clone (the default `actions/checkout` depth) cancels correctly
  too. A job building anything but the current tip cancels only strict ancestors it can see, so a
  force push is detected only by the job for the new tip.
- The git-history check trusts the CLI, as affected capture and ADR 0044 already do. The server's
  checks in decision 3 keep a wrong list from touching another branch, a finished build or a newer
  build.
- Existing projects change behaviour on upgrade. The setting is one click to turn off, and the
  release notes call it out.

## Non-goals

- Cancelling builds in review.
- Server-side detection without the CLI, such as from push webhooks.
- Cancelling across branches, for example when a pull request's branch is renamed.

## Delivery

1. Prerequisite: #757, comparing only against an approved build.
2. Core (#759): the two columns, a `BuildModel.supersede` helper that validates (decision 3) and cancels,
   and the status mapping (decisions 1, 3, 5, 6).
3. App (#760): the in-flight endpoint, `supersedes` on both build-creation endpoints, and the settings
   field in the project API (decisions 2, 3).
4. CLI (#761): the ancestry check and `supersedes` (decision 2), plus the website docs on clone depth.
5. UI (#762): the settings toggle and the superseded build page (decision 8; Designer spec first).
