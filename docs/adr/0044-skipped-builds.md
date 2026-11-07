# ADR 0044: Skipped Builds for Commits That Change No Story

## Status

Proposed (architect, 2026-11-04; asked for by the owner). Amends ADR 0004 (affected capture) and
ADR 0014 (git state). Implementation is split into issues listed under "Delivery".

## Context

Affected capture (ADR 0004) renders only the stories a change can reach and inherits the rest from
baselines. When a commit reaches **no** story, the build still costs a full upload: the CLI creates
the build, then computes the affected set, then zips and sends the whole Storybook, which the
server publishes and stores; every inherited snapshot gets a row. The Storybook demo received 55
such uploads in a week, most of them changing nothing visible.

Not uploading at all is not an answer. A commit with no StoryShelf status leaves a pull request
that requires the check blocked forever (ADR 0014, and the merge enforcement work of #27). The
commit needs a status, and the status must say truthfully what was compared.

The CLI cannot decide "nothing changed" before a build exists today: the server hands out the
comparison commit (`baselineSha`, the newest earlier build on the branch) only in the response to
build creation.

## Decision

1. **A new terminal build status, `skipped`.** A skipped build is a row with a commit, a branch and
   a **source build**: the build whose outcome it repeats. It has no Storybook upload, no capture
   job, no snapshots, no storage objects and no publishing. It is created only through the skip
   endpoint (decision 4), never by moving another status to it, and nothing moves it to another
   status (no retry, no cancel, no verdict).
2. **Opt-in from the CLI: `--skip-unchanged`** (config `skipUnchanged`, default off). With it, the
   CLI asks the server for a skip source (decision 3) **before** creating a build, computes the
   affected set against the source's commit locally (the same `computeAffected` as today), and
   only when the result is an empty list, with no full-capture reason, asks for a skipped build.
   An empty affected set says nothing about removed stories, so the request also carries the new
   index's entry ids; the server refuses (`409`) unless they equal the source build's catalog
   (`catalogOf`), so an added, renamed or deleted story always uploads.
   In every other case, including any error, it uploads normally. Skipping is an optimisation that
   may always be refused; it never fails an upload.
3. **Which build may be skipped from.** The candidate is what affected capture already compares
   against: the newest build on the same branch with a different commit
   (`resolveBaselineSha`). It is eligible only when its outcome is final and passing: `approved`,
   or `skipped` (then the source is that build's own source, so chains always point at a real
   build). A candidate that is `reviewing`, `rejected`, `failed`, `cancelled` or still running is
   not eligible: skipping from it would turn an open or failing check green without anyone looking.
   The first build on a branch has no candidate and is a normal build. Testing must be on (ADR
   0006); a hosting-only server never skips, because "no story changed" says nothing about the rest
   of a published Storybook. A project with `run_tests` on never skips either: every normal build
   runs its Storybook tests, and a failing test is a blocking failure, so skipping would hide one.
4. **Two endpoints, class `testing`** (classified in `api-routes.ts`, marked in OpenAPI, 404
   without `options.testing`):
   - `GET /api/v1/projects/:slug/builds/skip-source?branch=&sha=` answers
     `{ sourceBuildId, sha } | null`. It is a hint only.
   - `POST /api/v1/projects/:slug/builds/skipped` with `{ gitSha, gitBranch, sourceBuildId,
changedFiles, entryIds, idempotencyKey, labels?, message?, author? }` creates the skipped
     build. The server re-checks eligibility in the same transaction as the insert, so a source
     whose verdict moved after the hint answers `409` and the CLI uploads normally. It records
     `changedFiles` (bounded like the affected post) so the build page can show what was compared.
     `labels` are validated and attached exactly as on normal build creation, so `--label`
     (including `persistent`) is never lost.
   - **Ambiguous outcomes.** The CLI generates `idempotencyKey` once per run; a repeated key returns
     the build it already created. After a network failure the CLI retries with the same key, and
     uploads normally only on a definite refusal or when retries run out. Because a lost response
     can still leave a skipped row behind, normal build creation **replaces** any skipped build of
     the same project, branch and commit: it sets that row's `superseded_by_build_id` (ADR 0045's
     column), and `statusesForBuild` posts nothing for a superseded skipped build, so a stale
     queued notification cannot overwrite the real build's check.
5. **What the status says.** `statusesForBuild` (ADR 0014; one new case, no call-site status)
   gives a skipped build the **current** outcome of its source. For an `approved` source the
   `testing` (or `review`) gate is `success` with the description `No story changed since
<short sha>`. The informational `storybook` status links to the source build's Storybook while
   that build is available, and is left out once it is not. The pull-request comment says the same
   in one line and links both builds.
6. **A skipped build follows its source.** If the source's outcome changes later (a verdict moves),
   every path that calls `announceBuildStatus` and `requestBuildState` for the source also requests
   build state for the builds skipped from it (an indexed lookup on the source column), so a
   rejected source can never leave a green check on a newer commit.
7. **Treated like `approved` where builds are compared, like `cancelled` where they are acted on.**
   `skipped` is in `TERMINAL_BUILD_STATUSES` and not in `CANCELLABLE_BUILD_STATUSES` or the resume
   set. A verdict, retry, cancel, re-diff or promotion request on a skipped build answers `409`. It
   never becomes a baseline source and never changes a baseline. The same-commit shortcut
   (`hasApprovedBuildForSha`) does not count a skipped build as an approved one.
8. **Retention (ADR 0039).** A skipped build holds no storage, so it adds no build reference.
   Its source is **pinned**: retention resolves every skipped build it keeps (such as the latest
   build on a branch) to its source and keeps that source, inside the fenced
   `buildReferenceLifecycle` check, so a kept skipped build never loses its source. Deleting a
   source that nothing keeps deletes the builds skipped from it in the same pass. This lands after
   the resumable deletion of #374.
9. **Reads resolve through the source.** A skipped build has no catalog or Storybook of its own.
   `catalogOf`, the library's "latest build of the branch", and the skipped build's own Storybook
   and preview URLs resolve to the source build (same project, so the caller's access to the
   skipped build is the check). A build's own URLs therefore always answer; once the source is
   unavailable they answer as an unavailable build does.
10. **UI.** The builds list hides skipped builds by default, with a "Show skipped" filter; the
    branch and pull-request views show the newest build for a commit, skipped or not. A skipped
    build's page shows the source build, the changed files, and no snapshot tabs.

## Schema

`builds.skipped_from_build_id` (nullable text, indexed) and `builds.idempotency_key` (nullable
text, unique per project), plus `builds.superseded_by_build_id` from ADR 0045, in every dialect's DDL, Drizzle schema and
migration, plus the core row type (ADR 0041 is still proposed). `status` is free text in every
dialect, so the new value needs no constraint change.

## Consequences

- A commit that changes no story costs one small request and one row, not an upload, a publish and
  a capture pass, and it still gets a truthful status.
- Every place that switches over `BuildStatus` gains a case. The compiler finds the exhaustive
  switches; the tests in the first task must cover the non-exhaustive sets (decision 7).
- Skipping depends on the CLI's local git history and bundler stats being right, the same trust
  affected capture already has. A shallow clone missing the source commit makes `computeAffected`
  report a full-capture reason, so the CLI uploads normally.

## Non-goals

- Skipping the first build on a branch by diffing against the merge base with the default branch.
  The pull-request build is of the head commit, while inherited baselines come from the default
  branch as it is now, so "nothing changed since the merge base" would not be a truthful claim.
  Revisit with ADR 0038.
- Skipping for hosting-only servers, and skipping on the server side without the CLI.

## Delivery

1. Core: #548: The status, the column, `BuildModel` creation and lookup, every status consumer, and the
   status mapping (decisions 1, 5, 7).
2. App: #549: The two endpoints, eligibility in one transaction, follow-the-source state requests, and
   source resolution for reads (decisions 3, 4, 6, 9).
3. CLI: #550: `--skip-unchanged` / `skipUnchanged` (decision 2), plus the website docs.
4. UI: #551: Badge, hidden-by-default filter, skipped build page (decision 10; Designer spec first).
5. Retention: #552: Cascade to skipped builds (decision 8), after #374.
6. Demo: #553: `app-storybook.yml` passes `--skip-unchanged` once 1 to 3 ship in a release.
