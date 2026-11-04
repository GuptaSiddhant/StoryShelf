# ADR 0039: Build Retention Lifecycle and Build References

## Status

Accepted. SQLite activated (#536); Postgres and MySQL are open. This ADR amends ADR 0009 decision 4 (Retention and purge) for
deployments with `testing`; hosting-only retention is unchanged.

Merged: source-build provenance (#345), frozen comparison references and fail-closed testing purge
(#354), SQLite lifecycle primitives (#382), fenced baseline writers (#389), preparation of legacy
references (#397), sealing of the capability to fenced mutations (#372) and resumable deletion with
exactly-once content release (#374), per-build content uses (#564) and SQLite activation (#536).
Open: Postgres and MySQL capability (#375, #376) and investigations (#377 to #381).

Source of the decisions: the architect resolution on issue #343
(<https://github.com/GuptaSiddhant/StoryShelf/issues/343#issuecomment-6521055220>) and the #343 epic.

## Context

ADR 0009 treats builds as transient and baselines as independent objects. Investigations (replaying
the baseline and current story to explain a diff) need the **source build** of a baseline to still
exist, and affected capture means the build containing a snapshot is not always the build that
rendered it. Purge previously selected candidates, deleted storage, then deleted rows; a check
followed by independent writes races a concurrent baseline promotion and can delete a build that
was referenced a moment earlier. `DatabaseAdapter.transact` is optional and its isolation differs
by preset, so it cannot by itself carry this guarantee.

## Decision

### 1. Whole source builds are pinned by references

- An **active baseline** and a **queued or running investigation** pin whole source builds. Pinning
  individual artifacts was rejected: replay needs the whole published Storybook.
- A pin is a durable, uniquely keyed row in `build_references` (owner type + owner id + build id),
  with foreign keys where the backend supports them. Multiple owners may share one build.
- A historical diff does **not** pin its source build. The frozen comparison image and metadata stay
  with the consuming snapshot (#354); when no baseline or investigation needs the source build it
  is purged normally, and historical replay becomes unavailable. The UI and docs say so.
- Persistent labels (ADR 0010) keep protecting builds as before; retention reasons shown on a build
  are `baseline source`, `investigation in progress` or a persistent label.

### 2. Builds have an irreversible lifecycle

- `builds.retention_state` moves `available` → `deleting` → removed. `deleting` is a tombstone:
  it never returns to service and admits no new reference.
- Deletion is **claimed** only after an atomic check that no protecting reference remains, in the
  same concurrency domain as reference admission (`claimDeletion` returns `claimed`, `protected`,
  `deleting` or `missing`).
- Storage is deleted only **after** the tombstone commits, never under a database lock. Cleanup is
  idempotent with durable progress; a crash leaves the build unavailable and resumable. A cleanup
  lease may expire; the tombstone does not. Build ids and storage prefixes are never reused.
- Shared asset reference decrements are durable and exactly-once; an unrecorded decrement is never
  retried blindly. Content GC accounts for live manifests (ADR 0003).
- **The deletion driver** (`packages/core/src/retention/build-deletion.ts`) finishes a claimed build
  in three recorded steps: release its shared content, delete its storage objects (outside any
  transaction), remove its rows (one transaction). The capability records each step
  (`build_deletions`) and the release of each content hash once per build
  (`build_content_releases`, unique on build and hash) in the same transaction that releases the
  build's `content_uses` rows, so a retry skips what is recorded. Steps must run in order; a second
  cleaner finds the work done. Purge uses the driver only when the capability is present.
- **Shared content is counted as uses, not as a counter.** `content_uses` has one row per (build,
  hash), written idempotently by the capability (`recordContentUses`) after the blobs are stored
  and before the manifest that names them, by both upload paths, so a hash used at two paths
  counts once. The caller then checks that each blob still exists: a recorded use cannot be
  claimed, so a collector that finished between the caller's own check and the record is caught. A
  counter read and updated through the generic adapter path would race across processes and cannot
  be addressed by hash; the former `content_refs` table never held rows on a real adapter and is
  dropped, with nothing to backfill: a blob without a use row is protected by the manifest guard
  until its builds go. A build's release marks all its rows released (kept for the grace period).
  A collector **claims** a blob in the capability's domain (`claimContent`: every use released,
  the grace passed, no live manifest names it) under a per-pass token. A claim is durable and
  leased (30 minutes): it stays with its collector, so two collectors never delete one blob, and a
  later pass takes over one the lease has outlived, re-stamping it with its own token. Right
  before it deletes, a pass asks the capability whether its token still holds the claim
  (`holdsContentClaim`) and skips the delete if not; giving a claim back and finishing it are
  token-checked too, so a taken-over pass can do nothing. A claimed hash refuses new uses, so a
  use racing the delete ends in exactly one outcome: the claim fails because the use landed, or
  the use is refused and its caller stores the content again and retries. A live manifest found
  after the claim gives the claim back. A wrong use record can leak storage but never delete
  served content. The token is not a full fence: object storage cannot refuse a late delete, so a
  pass that stalls longer than the lease exactly between its check and its delete could still
  remove a blob a successor collected and a new build stored again. That window is one delete wide
  and needs a hung process, so it is accepted rather than fenced. Without the capability nothing
  is recorded or collected.

### 3. Lifecycle is an explicit database capability

- `DatabaseAdapter.buildReferenceLifecycle?: BuildReferenceLifecycle`
  (`packages/core/src/adapters/database.ts`) is present only when an adapter implements the
  cross-process contract. Exposing `transact` is not evidence of it.
- The capability serializes admissions, reference changes and deletion claims across processes,
  locks touched builds in a stable order, checks project ownership and availability, and commits
  reference changes together with their domain writes, through the fenced methods only. There is no
  unfenced replace: an unfenced write could release a newer owner's pin.
- **Generations fence owners.** Each owner has a durable generation; fenced mutations
  (`replaceFencedReferences`, `replaceManyFencedReferences`) compare and advance it, and a stale
  generation rejects the whole transaction. Generations survive release, so an old worker cannot
  release a newer owner's pin.
- Each implementation is proven with real multi-connection contract tests, not mocked transactions:
  `buildReferenceContractSuite` (`packages/core/src/test-helpers/build-reference-contract.ts`)
  covers promotion and pin against purge, a stale generation rejecting a whole multi-owner
  transaction with its domain writes, release keeping the generation, admission to a deleting or
  missing build, an admission racing a claim ending in exactly one outcome, and opposite-order
  multi-build admission without deadlock. Postgres and MySQL (#375, #376) must run the same suite.
- **Fail closed.** An adapter without the capability exposes investigations as unavailable, and a
  deployment with `testing` skips automatic build deletion and branch GC with an actionable admin
  explanation (`POST /api/v1/admin/purge` answers 503). There is no sequential fallback for the
  reference-sensitive path. Presets are enabled one at a time: SQLite first (#536, done), then
  Postgres (#375) and MySQL (#376).
- **SQLite activation** (`createSqliteDatabase`, `db-sqlite/src/retention-activation.ts`). When the
  adapter's setup has migrated the schema, it runs `prepareBaselineReferences` once and only then
  exposes `buildReferenceLifecycle`. A shared file is required, so an in-memory database never has
  it. If preparation stops with a `BaselineSourceIntegrityError` (a recorded source that is
  tombstoned or belongs to another project), the capability stays off, the adapter reports
  `retentionPause` (baseline, build, problem), the server logs it once at error level, and the
  System page shows "Retention is paused" naming both ids. Retention is then fail closed as for any
  adapter without the capability; an operator fixes the data and restarts. Any other preparation
  failure fails the boot instead of guessing. With the capability, `POST /api/v1/admin/purge`
  reports `{ removedBuilds, protected, resumed }` besides the branch figures, and the branch-GC
  timer runs in a testing deployment; both answer or skip as before without it. The daily timer
  purges builds only when `purgeTtlDays` is set explicitly (no default, so an upgrade never starts
  deleting builds), runs only this capability's path, and does nothing without it; hosts map
  `PURGE_TTL_DAYS`, core reads no environment.
  A purge pass (the route, the timer) reads the capability once when it starts and hands that one
  capability to every deletion of the pass (`PurgeOptions.lifecycle`); it never re-reads it, so one
  cleared mid-pass cannot make the pass unfenced (#602).

### 4. Provenance is immutable and never guessed

- Baselines and snapshots store a direct source-build id: the build that **rendered** the image, not
  the build that inherited it.
- At diff time an immutable comparison reference records baseline id/version, source build and
  snapshot when provable, reference screenshot path and hash, branch source, mode/target/settings
  and the original fingerprint. History is never reconstructed by following a mutable baseline row.
- Legacy and imported baselines are backfilled only with **provable** sources. Unknown stays
  unknown; visual comparison keeps working and replay is reported unavailable. A previously
  recorded source whose build is now missing keeps its id but gets no live pin. A tombstoned or
  cross-project source is an integrity condition: preparation stops with an actionable report
  rather than clearing the id (#397). Migration does not pretend to restore deleted data.

### 5. Every baseline mutation goes through the lifecycle

All writers use the fenced capability when it is present:

| Path                                                      | Mutation                                                                                                                                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `approveSnapshot` (`app/src/routers/builds.handlers.ts`)  | Review decision and promotion; drift is rechecked inside the promotion transaction (`approveInTransaction`)                                                                       |
| `core/src/capture/pipeline.ts`                            | Default-branch auto-accept and environment migration (`BaselineModel.upsert`); legacy fingerprint backfill (`backfillFingerprint`) skips on a write or generation conflict        |
| `BaselineModel.upsert` (`core/src/models/baseline.ts`)    | Explicit promotion and replacement, swapping the source reference atomically                                                                                                      |
| `core/src/models/baseline-transfer.ts` `import`           | Archive replacement or insertion with identity, version and source rechecked                                                                                                      |
| `removeOrphans`, `removeForBranch`, `removeStaleBranches` | Fenced release of the owner's references with the row removal                                                                                                                     |
| `prepareBaselineReferences` (`db-sqlite`)                 | Restartable, idempotent preparation of pins for existing known sources, under the same write lock as writers and deletion claims; invoked once at every SQLite boot, before the capability is exposed (#536) |

A new baseline write path must use the same authority (this includes #327 and #351); a check
followed by an independent write is forbidden.

`prepareBaselineReferences` pins only proven sources (#397). A recorded source whose build row is gone
keeps its `source_build_id` and gets no pin (reported as `unavailable`). A source that is tombstoned or
belongs to another project stops the whole run with `BaselineSourceIntegrityError` and rolls it back.
It also releases the pins of baseline owners that cannot justify one (the baseline row is gone, or it
records neither a source nor a snapshot): the unfenced path used while retention was off or paused
could leave them, and they would keep an unrelated build protected.

### 6. Investigations (decision level)

- On request by default; automatic investigation is a project opt-in. An investigation never changes
  a verdict, approval or the merge gate.
- Investigation creation acquires both source references atomically or reports unavailable. Pins
  are released on every terminal path, only after replay work has stopped; if teardown is
  uncertain, pins are retained and the job shows recovery-needed.
- Execution is a distinct job kind on the database queue with a dedicated consumer filter, admitted
  at most one per deployment and only when capture and publish work is not waiting (ADR 0040). A
  job is bounded to five minutes; an unavailable consumer is an explicit unavailable state.
- Results are bound to the exact comparison identity and never rebound to a moved baseline. Replay
  evidence is labeled as replay, never as the original render. Completed records and bounded
  evidence expire after 30 days by default and do not pin source builds.
- Replay is an optional runner capability (Playwright first) with fixed evidence limits and
  redaction; the limits and allowlists are specified in the #343 resolution and belong in
  `docs/architecture.md` once implemented.

## Consequences

**Positive**

- Purge cannot delete a build that a baseline or investigation has just started to reference, on
  any backend that advertises the capability.
- Provenance is honest: unknown sources are shown as unknown instead of guessed.
- Unsupported backends keep working for visual testing and fail closed for deletion only.

**Negative**

- Postgres and MySQL deployments with `testing` still do not purge builds or garbage-collect
  branches until #375 and #376; their storage grows and operators must be told.
- Postgres and MySQL need their own capability implementation and multi-connection tests before
  they regain automatic retention.
- Pinning whole builds keeps more storage than pinning artifacts would.
- Every baseline writer pays for a fenced transaction.

## Alternatives rejected

| Option                                         | Why not                                                                                              |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Rely on `transact`                             | Optional, and its isolation differs by preset; it does not prove serialization with deletion claims. |
| Check references, then delete                  | Races a concurrent promotion or investigation and can delete a live source build.                    |
| Pin every build a historical diff touched      | Unbounded retention of comparison graphs; frozen comparison images already keep history reviewable.  |
| Sequential fallback for unsupported adapters   | Silently weakens the guarantee instead of failing closed.                                            |
| Guess legacy sources from the containing build | Wrong for inherited snapshots; presents false provenance.                                            |

## Open questions

- Batching of the SQLite preparation, only if a deployment outgrows the startup budget. Measured
  on a 10,000-baseline fixture (each with its own source build; `RUN_BENCH=1` in
  `db-sqlite/src/retention-activation.test.ts`), preparation takes about 3.9 s and a whole boot
  3.5 to 3.7 s, roughly 0.4 ms per baseline and linear, so it fits the 5 s budget up to about 12,000
  baselines. Batching is not designed; the first deployment past that size designs it.
