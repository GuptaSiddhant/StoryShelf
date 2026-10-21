# ADR 0009: Baselines, Approval and Retention

## Status

Accepted

Supersedes (archived): ADR 0009

## Context

Visual testing hinges on one question: which screenshot is a new capture compared against? Two
models were considered.

1. **Always diff against the default branch.** Simple, but every commit to a feature branch
   re-flags stories already accepted against an untouched default branch, and multi-commit PRs force
   reviewers to re-approve the same change repeatedly.
2. **Per-branch baselines with fallback to the default branch** (Chromatic's model). Accepting a
   change on a branch records a baseline for that branch; later builds on the branch diff against
   it. Stories never accepted on the branch fall back to the default branch.

A second, orthogonal concern is retention. The server stores every screenshot and never clones a
repository to re-derive them, so screenshots accumulate. Baselines are the durable truth;
everything else is transient.

## Decision

### 1. Per-branch baselines with fallback

A baseline is keyed by project, story, mode (or viewport) key, capture target and branch. The mode
key is the slug of the mode name and the capture target is the engine, or `<engine>@<name>` for a
remote browser (ADR 0004 Capture Pipeline, ADR 0007 Remote Browsers and Public Origin). A remote
target has its own baselines and never compares against a local render of the same engine, because
different hosts, fonts and GPU paths would turn every comparison into noise or a migration.
Renaming a target starts fresh baselines for it. Baseline rows with no recorded target mean local
`chromium`.

For a snapshot on branch `B`, the baseline is chosen as follows:

1. The baseline for `B`, if present.
2. Otherwise the baseline for the project's default branch.
3. If neither exists (a brand-new story, or a new mode or target):
   - on the **default branch** the snapshot is auto-approved and becomes the baseline;
   - on a **feature branch** the snapshot is marked `new` and needs review.

A new engine or target bootstraps rather than copying: it auto-accepts a story's first snapshot
when the primary engine's snapshot of it is clean, and otherwise sends it to review as `new`.
Screenshots are never copied across engines.

The canonical baseline is a stored **screenshot object**, independent of any build, so it survives
build purge. A story removed from Storybook leaves no diff to run.

### 2. Approval

- **Accept** points the baseline row for the snapshot's branch at the accepted snapshot's
  content-addressed screenshot (ADR 0003 Storage and Content-Addressed Assets) and upserts the row.
  Nothing is copied. **Reject** marks the snapshot rejected and writes nothing.
- **Shared approval.** One decision covers a story and mode on every engine and target. It is
  atomic on drift: if any target's baseline moved since the build, nothing is approved unless
  forced, and approve-all skips a whole group when one member drifted. Per-snapshot approve and
  reject remain as an escape hatch.
- **Merge needs no promotion step.** The next default-branch build re-captures everything and
  auto-approves, re-baselining the project. Default-branch changes are auto-approved.
- **Auto-accept of builds.** A build on the default branch is always accepted (`approved`),
  whatever `testing` or the project's `review` setting says, unless capture failed. A build on any
  other branch is accepted automatically with `testing` off only when the project's `review` is
  off. With `review` on (the default) it stays `pending` for build-level approval (ADR 0013 UI
  Review). With `testing` on, snapshot approval decides the build status. Accepted builds that
  nobody reviewed carry no approval event.
- Importing and exporting baselines is a `testing` capability (ADR 0006).

### 3. Environment fingerprints

Each capture records a fingerprint of its environment: engine, browser build, host platform,
device scale factor, a digest of the system fonts, and viewport and sizing defaults. For remote
targets the fingerprint is read from inside the browser, so it describes the machine that rendered
(ADR 0007). Components are compared with the baseline's one by one, and only where both sides
report a value. A component a capture did not report is unknown, not a change, and is never written
over a known value on the baseline. Viewport is recorded but never counts as a change, since its
size comes from story parameters and a new size diffs as a dimension change.

A difference in any other component is an **environment change**, recorded on the snapshot
(`snapshots.env_change`):

- On the **default branch** it is a **migration**: no pixel diff is computed, the snapshot is
  accepted as `unchanged` and the baseline is rewritten with the new screenshot and fingerprint.
  The default branch is authoritative and auto-approves its own changes anyway. A regression that
  lands on the default branch in the same build as an environment change is masked; this is
  accepted.
- On **any other branch** the snapshot is still diffed, and a difference is `changed` (review
  required) with the environment change attached, so the review page can say "probably the
  environment". Auto-accepting there would suppress every diff on every branch until the default
  branch re-rendered each story, which can be indefinite when affected capture leaves stories
  unrendered.

A capture pool should be homogeneous (same image, architecture and fonts), or feature builds show
environment noise until the default branch migrates. Baselines from before fingerprints are
compared normally and backfilled.

### 4. Retention and purge

**Never purged:** default-branch baselines, and builds bearing a `persistent` label (ADR 0010
Projects, Published Storybook and Labels). Feature-branch baselines go through branch GC below.

**Purged:**

- Builds in a terminal status (`approved`, `rejected`, `failed`) older than `purge_ttl` (default 30
  days).
- Old builds of a branch: the most recent build per branch is retained (it backs the PR status
  link); older ones are purged past the TTL.
- `pending` builds, in exactly two cases. A `pending` build with no attempts, no verdicts and no
  comments is **superseded** when a newer build exists for the same branch and becomes purgeable
  like a `rejected` build. Any other `pending` build becomes purgeable after the retention window,
  measured from its last activity (comment, verdict or upload), not from creation. No build status
  is added.
- Builds in other non-terminal states (`capturing`, `comparing`, `reviewing`) are never purged, so
  a build under review does not vanish.
- Finished job rows of the database queue (ADR 0006) are purged with the rest of retention.
- **Stale branch baselines:** branches whose latest build is older than `branchTtlDays` (default
  30; `null` disables) lose their baseline rows. The default branch is never garbage-collected.
- A build's catalog (`build_components` rows and compact catalog file, ADR 0006) is purged with the
  build.

A `pending` build is never the project's served Storybook; the link keeps resolving the previous
accepted build, and the retention rules above are what stop `pending` builds accumulating.

**Screenshot reclamation.** Screenshots are content-addressed per project
(`<project>/content/<sha256>.png`), shared by snapshots and baselines. Purging a build or baseline
removes rows; the stored bytes are reclaimed by **mark-and-sweep** in the retention purge:

- An object that no snapshot or baseline references is deleted once it has stayed unreferenced
  across two sweeps at least 24 hours apart. First-seen times live in
  `<project>/content/.sweep.json`, so no schema change and no storage `stat` is needed.
- Each candidate is re-checked against the database immediately before deletion.
- Reusing an existing object writes nothing, so the sweep cannot see a reuse in flight, and a
  capture may hold a reuse for minutes or hours before its snapshot rows land. The sweep therefore
  defers every deletion in a project while a build of the project is `pending`, `capturing` or
  `comparing` and was updated within the grace period (a stuck build delays reclamation but never
  blocks it for good), or while a reuse claim younger than the grace period exists. Claims
  (`<project>/content/.claims/<ulid>.json`) are written by baseline import and by approving a
  legacy per-build snapshot around their store-then-write-rows step.
- Local storage writes through a temp file and a rename, so a torn file never sits at a content
  address, and keys are listed `/`-separated on every host.
- Older per-build and per-baseline files keep working and are cleaned up as before. Statics use
  reference counting instead (ADR 0003).

**Orphaned baselines.** On each default-branch build, `index.json` is compared with the baselines
and baselines whose story no longer exists are deleted; their bytes are reclaimed by the sweep. A
removed mode or target leaves stale baselines, which are not pruned yet.

### 5. Triggers

- **Scheduled** in-server timers: build purge (`--purge-interval`, default hourly) and branch GC
  (`branchTtlDays` plus `branchGcIntervalMs`, a daily clock staggered one hour).
- **Manual:** `storyshelf purge` or `POST /api/v1/admin/purge`, which runs build purge and branch GC
  and returns `{ removedBuilds, removedBranches, removedBaselines }`.
- **Switching `review` off** accepts, in one pass at save time, the project's `pending` builds that
  have no attempts and no snapshots, so no queue is left that nobody will clear.

## Consequences

**Positive**

- No re-review of already-accepted changes on multi-commit PRs.
- Baselines survive build purging; they are objects, not pointers into a transient build.
- Disk usage is bounded by the TTLs and per-branch retention; unfinished reviews do not pile up.
- Accepting a baseline is a repoint, and identical screenshots are stored once.
- Merge-to-default is implicit.
- Remote and local renders are never compared, and provider image changes are diffed or migrated
  visibly rather than waved through.

**Negative**

- Feature-branch baselines can diverge from the default branch; a pull after the default branch
  moves under a story re-flags it. Correct, but surprising the first time.
- Auto-approving the default branch baselines a regression pushed straight to it. This is an
  accepted consequence, with a possible future "require approval on default-branch changes".
- Content-addressed blobs shared across builds and baselines complicate GC; the two-sweep rule and
  claims trade prompt reclamation for safety.
- Remote browser builds move under the operator: each move is a baseline migration on the default
  branch. Pinning the browser version in the preset is the operator's job.
- `approved` does not always mean someone or some check approved the build; a hosting-only build
  accepted on publish is shown as "Published".

## Alternatives rejected

| Option                                          | Why not                                                                                                                    |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Always diff against the default branch          | Re-flags accepted changes on every commit of a feature branch.                                                             |
| Auto-accept environment changes on every branch | Suppresses diffs until the default branch re-renders each story, indefinitely under affected capture.                      |
| Reference counts for screenshots                | Every delete path (builds, baselines, imports, project delete) would have to stay balanced, and a miss frees a live image. |
| Per-object claims on every dedupe hit           | Writes on exactly the path whose point is to write nothing.                                                                |
| Copying baselines across engines                | Font and anti-aliasing differences make every story diff.                                                                  |
| Keeping `pending` builds forever                | They are never served and never purged.                                                                                    |

## Open questions

- Whether the required-approvals count and the retention window for `pending` builds are project
  settings or defaults only.
- Pruning stale `(story, mode, target)` baselines of a removed mode or target.
