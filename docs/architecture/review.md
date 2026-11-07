# Baselines and review

> Part of the [StoryShelf architecture spec](./README.md).

## Baseline Resolution & Review Workflow

### Resolution (per-branch with fallback to default)

For a snapshot of `(story, mode, browser)` in a build on branch `B`:

1. Look up `baselines(project, story, mode, browser, branch=B)`. If found, diff against it.
2. Otherwise, fall back to `baselines(project, story, mode, browser, branch=default)`.
3. If neither exists (a brand-new story):
   - On the **default branch**: auto-approve and write the baseline.
   - On a **feature branch**: mark `new` (needs review).

A newly enabled browser has no baselines yet: its first snapshots are auto-accepted where the primary browser's snapshot of the same story and mode is clean, otherwise they are `new` (ADR 0004).

Resolution is a pure key lookup — no git ancestry or build history is consulted, so rebases, force-pushes and squash merges cannot break it (covered by tests in `baseline.test.ts`).

This is what "per-branch acceptance with fallback to default" means: accepting a change on a feature branch writes a baseline **for that branch**, so subsequent commits on the same branch diff against the accepted version instead of re-flagging the same change against an untouched default branch.

### Workflow

1. **Build created** -- status `pending`, snapshots not yet captured
2. **Capture + diff run (async)** -- each snapshot becomes:
   - `unchanged` (within threshold, auto-approved) or
   - `new` (no baseline, feature branch) or
   - `changed` (exceeds threshold)
3. **Reviewer opens build page** -- sees `new`/`changed` stories with diff overlays
4. **Reviewer accepts** -- snapshot `approved`; that branch's baseline updated
5. **Reviewer rejects** -- snapshot `rejected`; no baseline change
6. **All changed stories resolved** -- build status `approved` or `rejected`
7. **Merge to default** -- the next default-branch build re-captures and auto-approves, re-baselining the project

### Baseline changes after a diff

A snapshot's diff is frozen at capture time, but baselines move (a merge to the default branch
re-baselines; another build on the same branch may be approved first). Each snapshot therefore records
`baseline_id` + `baseline_version` (the baseline's `updated_at`), and the app compares them with the
baseline that applies _now_ (own branch, else default):

| Status    | Meaning                                                                 |
| --------- | ----------------------------------------------------------------------- |
| `current` | Same baseline the diff used                                             |
| `stale`   | A different or updated baseline now applies (or a new story gained one) |
| `removed` | The baseline the diff used no longer exists                             |
| `unknown` | Legacy row without tracking; never blocks review                        |

- **Approval guard.** Approving a `stale`/`removed` snapshot returns `409 baseline_changed` instead of
  overwriting a baseline the reviewer did not see; `?force=true` overrides it (logged). Bulk approve skips
  such snapshots and returns their ids in `skipped`. The check runs immediately before the baseline write
  but is not atomic (the database adapter updates by id only).
- **Recapture is manual.** Nothing re-renders or re-diffs when a baseline changes. The review and build
  pages show a notice ("Baseline changed since this build was captured") with two choices:
  **Re-diff** (`POST /api/v1/projects/{slug}/builds/{id}/rediff`) recomputes undecided snapshots from the
  stored screenshots without rendering, and **Retry capture** re-renders every story.
- Re-diff skips approved/rejected snapshots (decisions), inherited snapshots (never rendered), and
  default-branch builds (authoritative); the build roll-up is refreshed afterwards.

### Capture environment fingerprint

A baseline stores a `Fingerprint` (JSON, `packages/core/src/capture/fingerprint.ts`) next to its
`infraHash`; a snapshot stores the `infraHash` of its capture and, when the environment differed from
its baseline's, the before and after fingerprints in `envChange`. A fingerprint holds: engine, browser
version, platform, device scale factor, fonts digest, viewport and sizing. The hash covers exactly those
components; a difference on the default branch is an environment migration (ADR 0009), on a feature
branch it rides along as `envChange`.

**Measurement version.** `measurementVersion` says how the browser-measured components were read. It is
**not part of `infraHash`**, so changing it never changes a baseline's identity or causes a mass
migration; a fingerprint stored without it is version 1.

- Between two different versions, a component whose measurement changed (listed per version in
  `REMEASURED_IN`) is compared as **unknown**, never as a mismatch: it cannot cause a migration, an
  earlier value of it is not carried over a capture that lacks it, and the review says "Environment
  partly unknown (measurement updated)". Components measured the same way still compare; with equal
  versions nothing differs from before.
- Bump `MEASUREMENT_VERSION` only together with a probe change, and add the components that probe change
  re-measures to `REMEASURED_IN` in the same commit.

| Version | What it measures                                                                               |
| ------- | ---------------------------------------------------------------------------------------------- |
| 1       | The in-browser probe of the first fingerprint release: browser version, platform, scale, fonts |

### Baseline Portability (export/import)

Baselines are portable between instances (backup/restore, migration, staging → prod promotion):
`GET /api/v1/projects/:slug/baselines/export[?branch=]` streams a zip and
`POST /api/v1/projects/:slug/baselines/import` (approver or admin) upserts from the same format.
`BaselineTransferModel` (`core/models/baseline-transfer.ts`) owns both directions; the router only
handles HTTP.

- **Format v1.** `manifest.json` (`format: "storyshelf-baselines"`, `version: 1`, `exportedAt`,
  `project`, `branch`, `baselines[]`, `skipped[]`) plus one PNG per baseline at
  `baselines/<branch>/<storyId>/<mode>[~<browser>].png` — the storage layout without the project id.
  Each manifest entry carries the identity (story, mode, browser, branch), `mode` JSON, `infraHash` and its `fingerprint`,
  timestamps, the zip `file`, and its SHA-256. Images are STORE-d (PNGs are already compressed) and
  streamed one at a time; the manifest is written last. Missing images are listed under `skipped` (and logged); other storage
  errors, or growing past the 512 MiB archive limit shared with import, abort the stream.
- **Import is all-or-nothing validation, then upsert** (images stored first, rows applied in one
  transaction when the driver has one, imports for the same project serialized within one process by an in-memory queue, not across app instances). The archive (buffered, capped at
  `min(maxUploadBytes, 512 MiB)`) is checked before any write: zip structure (no zip64, encryption,
  or multi-disk; entry-count, per-entry and total-size limits applied before inflation; CRC checked),
  entry names (no absolute paths, `..`, backslashes), manifest schema, identity segments (the same
  checks as `baselinePath`), PNG signature, and SHA-256. Storage paths are always derived from the
  manifest identity — zip entry names are lookup keys only. Rows keep their exported timestamps;
  `snapshot_id` is cleared because snapshots are not portable. Import emits no webhooks.
- **Out of scope.** Builds, snapshots, and review history (builds are transient by design).

### Review Comments

Reviewers and developers can leave **threaded comments** on any snapshot, on a story of the build's catalog (`story_id`), or on the build as a whole (an anchor is exactly one of the three), and mark threads **resolved** once addressed. A comment on an unresolved snapshot keeps it in `changed` until the author pushes a fix and it is re-approved — this is the "request changes" flow. Comments persist on the build until the build is purged.

### Build-level review

With `testing` off (ADR 0013, decision 3) the verdicts in `build_reviews` decide a `pending` build. `deriveReviewStatus` (`core/src/models/build-review-status.ts`, pure) takes `testing`, the review switch, the required approvals and a build's reviews: `null` when they do not decide (`testing` on, or review off), `rejected` when any reviewer's latest verdict (`latestVerdicts`: newest `created_at`, then id; a missing user is one anonymous reviewer) is `rejected`, `approved` when at least `max(1, review_approvals)` latest verdicts approve, else `pending`. `BuildReviewModel.add` keeps `created_at` strictly increasing within a build. The routes `GET|POST /api/v1/projects/:slug/builds/:buildId/reviews` (`app/src/routers/build-reviews*.ts`, class `review`; read is `viewer`+, write is approver and admin) answer 404 when the project has review off; `giveVerdict` stores the row (attributed to a user: the session user or the owner of the bearer token, via `resolveReviewer` in `routers/helpers.ts`; with auth on a caller without a user, such as the bootstrap admin token, gets 403; an instance with no auth records `user_id` null, one anonymous reviewer, accepted only while `review_approvals` is 1, else 409; a build whose Storybook is not yet published, `publishingOf` in `core/capture/publish/published.ts`, the probe behind `<prefix>/storybook`, answers 409), applies the derived status to a build that is `pending`, `approved` or `rejected` (a `failed` build answers 409; with `testing` on the verdict is a sign-off that moves nothing), and ends in `announceBuildStatus` (git state, `build:<status>` webhook, notifications) for every move, including a return to `pending` (`build:pending`), or `requestBuildState` when the status did not move. `statusesForBuild` shows the approval progress on a pending `<prefix>/review` (`approvals` input, loaded by `deliver.ts`) and, with review off, a final `success` (`Review is off`) for an accepted build. A verdict belongs to its build: a new push is a new build and needs its own approvals. The `review` class gate is the middleware `requireReview` (`app/src/middleware/require-review.ts`, after `authGate`): it answers 404 for every route classed `review` when the project has review off, reading the switch on each request, and only to a caller who may view the project (anyone else gets the route's own refusal).

**The review UI.** The build page (`pages/build-detail.tsx`) renders `VerdictCard` (standing, approvals against the requirement, each reviewer's latest verdict, approve and reject for approvers and admins; a "Waiting for the Storybook to publish" notice in place of the form while `publishingOf` is `pending`), `ChangesetCard` and `CommentsCard` from `loadReviewSection` when review is on; with `testing` off the verdict card and the changeset are the page's main content, with `testing` on the changeset sits above the snapshots and the verdict and comments below. The changeset (`core/src/models/changeset.ts`) is `computeChangeset` over the build's `build_components` rows and the rows of its baseline build (`findChangesetBaseline`: the latest accepted build of the branch created before it, else of the default branch): components added, removed and changed by hash (the hash covers story id, name, type and title), plus the count of unchanged ones; `GET …/builds/:buildId/changeset` returns it. Story comments show under the previewed story of the component page (the build it shows) and in the snapshot review thread of that story. Browser forms post `application/x-www-form-urlencoded`, which the JSON API refuses, so the comment, resolve and verdict forms post to page routes in `routers/review-forms.ts` (class `review`, CSRF-guarded) that call the API handlers. The review switch and approvals are edited in the General settings tab (`POST /projects/:slug/settings/review`, project admins; class `hosting` so review can be turned back on); turning review off runs the switch-off pass (`acceptPendingWithoutWork`, `core/src/models/review-switch-off.ts`): the project's `pending` builds with no capture attempts and no snapshots become `approved`, with no approval event.

**Events.** `review:requested` (the `afterPublish` hook in `publish-setup.ts`, for a published build left `pending` without `testing`; recipients are the channels and webhooks plus the project's approvers and admins by email unless they opted out: `defaultTargets` in `notify.ts`, an `enabled = false` subscription, `review_requests = false` or a topic list without the event opts out; unticking "Email me" keeps the row switched off instead of deleting it, which would restore the default), `comment:created` (every comment, `data.scope` build, story or snapshot; `review:comment` is only a filter alias, for webhooks, channels and subscriptions, matching the build and story scopes; see `matchesEvent` in core) and `review:verdict` (every verdict) are raised by `announceReview` (`app/src/review-events.ts`): signed webhooks plus the notification fan-out. No comment raises two events.

### PR Status Checks & Merge Gate

A git channel (a `notification_channels` row whose provider declares `delivery: "state"`, ADR 0014) shows the build's current state on its `git_sha`: commit statuses and one pull-request comment. What it shows is a pure function of the build, `statusesForBuild` (`core/src/adapters/notifier/build-state.ts`), so a build that was never captured posts too:

| Status               | Shown when                                                                 | State                                                                                                                                                                                               |
| -------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<prefix>/testing`   | `testing` is on                                                            | `pending` while captured or while review is open, `success` when all `new`/`changed` snapshots are approved, `failure` when rejected or capture failed, `cancelled` when a user cancelled the build |
| `<prefix>/review`    | `testing` is off and the project has review on (`projects.review_enabled`) | `pending` until the build is decided, `success` once approved by verdicts, `failure` when rejected or failed, `cancelled` when cancelled (see Build-level review)                                   |
| `<prefix>/storybook` | every build with a commit                                                  | `success` linking the published Storybook, `failure` for a failed build that never published, else `pending`; informational                                                                         |

The point of the `testing` status is to **block the merge**: the repo owner marks it as a _required check_ in GitHub branch protection (or a required pipeline/approval rule in GitLab), so a PR cannot merge until StoryShelf reports `success`. This is the v1 primitive.

A git channel is project-scoped and holds `{ owner, repo, host?, prefix? }` in its config and the token in its encrypted secret column; its event filter is fixed because state channels follow the build, not a topic list. The prefix defaults to `storyshelf` and carries no project slug. Because a repo may host several projects (one per Storybook), each project's channel for that repo takes its own prefix (`storyshelf-web`, `storyshelf-docs`), so multiple Storybooks on the same commit don't collide. Links are absolute from `publicBaseUrl`. The comment (build and Storybook links, visual and snapshot summary) is keyed by the build URL.

**Delivery** is one publisher, `BuildStatePublisher.request(buildId)` (`core/src/capture/build-state/`), called on every transition: build creation (`createBuildRecord`), capture start and end (`dispatch.ts`, `crash-failure.ts`), a review outcome (`refreshBuild`) and the end of publishing (an `afterPublish` hook). With a queue consumer it enqueues one `notify` job per enabled git channel (`createNotifyEnqueuer`; a job already waiting for the same channel and build absorbs the request); the app runs them on a queue and consumer of their own (`jobs-setup.ts`, four at once). The handler (`createNotifyHandler`) reads the build when it runs, computes the states for that channel and calls `setState` for each status and the comment (idempotent, latest wins), so a retried or reordered job cannot post a stale state. A refused write fails the job; the consumer retries it (5 attempts, 10 s doubling to 5 min). After the last attempt (`notifyExhausted` covers a last attempt that lost its lease) the channel row keeps the sanitized error and time (`last_error`, `last_error_at`; shown on the settings page, cleared by the next success) and `sys:notify-failed` goes to the site-wide channels. With no consumer (serverless) the publisher delivers inline and records the outcome on the channel, without retries. Message channels stay inline and best-effort.

**Check runs (ADR 0014, decision 13).** A GitHub channel's `mode` is `statuses` (default) or `checks`; GitLab always posts statuses. In `checks` mode the config also holds `appId` and `installationId` and the encrypted channel secret is the GitHub App's private key (PEM); `notify-git` signs an RS256 JWT with `node:crypto` (`github-app.ts`), exchanges it through `httpJson` and caches the installation token per channel until five minutes before expiry. The same `statusesForBuild` output drives both modes: each `DesiredStatus` may carry `progress` (`queued` before capture, else `running`), `informational` (the Storybook status) and, on `<prefix>/testing`, `annotations` (one per `new`/`changed` snapshot, at most `MAX_ANNOTATIONS` = 200, plus `omitted`), which `writeBuildState` hands to the provider on the `status` target. `github-check-mapper.ts` (pure) maps a status to the check run (`queued` / `in_progress` / `completed` with `success`, `failure`, `cancelled` or `neutral`), its `external_id` `storyshelf:<context>` and the annotation batches of 50; `github-check.ts` finds the run of the head SHA by that id and updates it (or creates it), appends batches in order and skips annotations the run already holds. An annotation links to `UrlBuilder.snapshot(slug, buildId, snapshotId)` (`…/builds/<id>/diff?snapshot=<id>`; label, branch and path values are encoded per segment). `storyshelf protect` (CLI) validates and, with `--apply`, writes the branch's required-check rule through the host API. Auto-rejecting a PR on a rejected build is not implemented.
