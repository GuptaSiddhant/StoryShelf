# ADR 0005: Capture Performance and Sharding

## Status

Accepted

Supersedes (archived): ADR 0031

## Context

Capture (ADR 0004, Capture Pipeline) and the pixel diff (ADR 0008, Image Diff Engines) run in the
app's Node process. Several structural issues limit throughput and robustness:

1. **The diff blocks the event loop.** Decoding two PNGs, running `pixelmatch` and encoding the
   overlay is synchronous CPU work on the same thread that carries the browser protocol traffic.
   PNG encode and decode dominate the diff pipeline's time; `pixelmatch` itself is a small
   fraction. The overlay was encoded even for diffs that pass.
2. **The unit of work is the whole build.** One job capturing every story on every target caps
   parallelism at one process, makes a retry redo the whole build, and makes progress coarse.
3. **One crashing story takes its neighbours with it.** A browser crash fails the whole render
   call.
4. **Environment drift reads as visual change.** A new browser build, platform or font set changes
   pixels everywhere, and nothing told it apart from a regression.
5. **Screenshots are stored once per snapshot and baseline**, even when the bytes are identical.
6. **Capture configuration was spread** across top-level options and `config`, although capture is
   optional and a deployment may host Storybooks only.

## Decision

### 1. Diff performance

- **Byte-equal fast path.** Both buffers are hashed first; on a match, width and height are read
  from the PNG header (IHDR) and the result is `passed` with zero changed pixels and no overlay.
- **Lazy overlay.** `pixelmatch` runs with no output buffer first; only a failing diff reruns with
  an output buffer and encodes the overlay.
- **Worker pool.** `diffImagesAsync` runs on a `worker_threads` pool owned by `@storyshelf/image`
  (ADR 0008). Default size `max(1, availableParallelism() - 1)`, set by `testing.compare.threads`,
  `0` meaning in-thread. Buffers are transferred, not copied. When `worker_threads` is unavailable
  or the worker fails to load, the pool falls back to the in-thread path:
  - a worker dying before `ready` is a load failure only while no worker has ever started; after
    that it is a crash, and the pool gives up only after three crashes in a row;
  - falling back never drops a running diff, and emits one `STORYSHELF_DIFF_POOL_FALLBACK` process
    warning.
- **One call site.** `diffStoredScreenshots` serves both capture persistence and re-diff.
- **Bounded re-diff.** Re-diffing a build runs with bounded concurrency (`mapLimit`), never an
  unbounded `Promise.all`.

### 2. Page concurrency

- **Per-engine weights.** A Firefox or WebKit page counts as about two Chromium slots (published
  cross-browser benchmarks measure them roughly 60-70% slower than Chromium).
- **Adaptive controller.** In-flight pages rise while p95 capture latency and event-loop lag stay
  flat and back off on timeouts. The latency baseline comes from the first window without a
  timeout, so an early timeout cannot inflate it.
- Remote targets are bounded by their preset's session cap instead (ADR 0007, Remote Browsers and
  Public Origin).

### 3. Scratch cleanup

A build's job extracts into `<build>/job/` and each shard into `<build>/shards/<shard>/` under the
scratch directory, so removing one can never reach another. Each removes its own directory in a
`finally`, and then the build's directories if that leaves them empty (`rmdir`, so a directory
still used by a running duplicate is kept). Inline extraction at upload cleans up the same way, and
a boot sweep removes directories orphaned by a crash. The scratch directory (`config.scratchDir`)
defaults to the OS temp directory.

### 4. API surface

All capture configuration lives under `ShelfOptions.testing` (ADR 0006, Testing Option,
Hosting-Only Mode and the Database Queue): `runner`, `compare`, `images`, `concurrency`,
`shardSize`, `retries`, `storybookUrlRateLimit`, `queue`, `workerEntry` and `mode`. Absent, the
deployment hosts Storybooks only and the tuning fields are unreachable rather than ignored.
`scratchDir` stays in `config`, because publishing uses it too.

- **No aliases.** Old flat keys are removed, not deprecated; `ShelfConfig` is strict, so a stale
  key fails at boot.
- **Viewports stay global.** `config.viewports` is the default when neither Storybook nor story
  parameters set viewports. Screenshots are mostly of the content box, so a per-project base set
  earns little.

### 5. Capture fingerprint and environment changes

Each snapshot records a capture fingerprint covering engine, browser build, platform, device scale
factor, a digest of the fonts, viewport and sizing defaults. For a local target these come from the
host; for a remote target they are measured inside the browser (ADR 0007).

- **Compared per component, only where both sides know it.** A component a capture did not report
  (a runner that does not report it, screenshots spooled before a browser crash, a failed font
  probe) is unknown, not a change, and is never written over a known value on the baseline.
- **Viewport is recorded but is never a change:** its size comes from story parameters, so a new
  size is the change under review and diffs as a dimension change.
- **Any other component changing is an environment change**, recorded on the snapshot
  (`snapshots.env_change`):
  - On the **default branch** it is a migration: no pixel diff is computed, the snapshot is
    `unchanged`, and the baseline is rewritten with the new screenshot and fingerprint
    (`baselines.fingerprint`). Accepted trade-off: a regression landing on the default branch in
    the same build as an environment change is masked.
  - On **any other branch** the snapshot is still diffed, and a difference is `changed` with the
    environment change attached, so the review page can say "probably the environment".
- **Pools should be homogeneous** (same image, architecture and fonts), or feature builds show
  environment noise until the default branch migrates.
- Baselines without a fingerprint are compared normally and backfilled.

### 6. Content-addressed screenshots

Screenshot blobs are stored as `<project>/content/<sha256>.png`: per project, so deletion and
isolation stay simple, and shared by snapshots and baselines (a baseline repoints instead of
copying). An upload is skipped when the bytes already exist. Identical paths mean identical bytes,
so the diff is skipped without reading either image. Older per-build and per-baseline files keep
working. Storybook statics use a separate, reference-counted scheme (ADR 0003, Storage and
Content-Addressed Assets).

Screenshots are reclaimed by **mark-and-sweep** in the retention purge, not by counters:

- An object no snapshot or baseline references is deleted once it has stayed unreferenced across
  two sweeps at least 24 h apart. First-seen times live in `<project>/content/.sweep.json` (no
  schema change, no storage `stat`). Each candidate is re-checked against the database immediately
  before deletion.
- Reusing an existing object writes nothing, so a sweep cannot see the reuse. The sweep therefore
  defers all deletion in a project while reuse may be in flight: a build of the project is
  `pending`, `capturing` or `comparing` and was updated within the grace period (so a stuck build
  delays reclaiming but never blocks it for good), or a reuse claim
  (`<project>/content/.claims/<ulid>.json`, written by baseline import and by approving a legacy
  per-build snapshot around their store-then-write-rows step) younger than the grace period exists.
- Local storage writes through a temp file and a rename, so an interrupted write never leaves a
  torn file at a content address, and lists keys `/`-separated on every host.

### 7. Sharded capture

Sharding is opt-in through `testing.shardSize`; unset, a build is one job. A job with no shard
covers the whole build.

- **A shard** is a slice of a build's stories with all of their targets and modes. A story's
  targets stay in one shard, so a newly enabled target can bootstrap from its sibling (ADR 0004).
- **Stages.** A build's `plan` job discovers stories, plans shards and enqueues one `render` job
  per shard on the database queue (ADR 0006). Shard rows live in `capture_shards` (kinds `plan`,
  `render` and a `finalize` claim row); each delivery of a shard is a `capture_jobs` row referencing
  its shard row. The planner emits a single shard below the size threshold, so small Storybooks pay
  no sharding overhead.
- **Planning.** With no timing history, shards are contiguous slices of about `shardSize`
  captures. Runners report `RenderedSnapshot.durationMs`, persisted as `snapshots.duration_ms`
  (nullable). When a build will shard, the plan reads per-story totals from the newest recent build
  with timings (at most three builds scanned) and packs longest-processing-time first: dearest
  stories first, each into the shard with the least work that still has room, shards enqueued
  heaviest first. A story with no timing is priced at the average capture cost.
- **A plan replaces earlier plans.** A new plan of a build drops the build's earlier snapshots and
  cancels attempts an earlier plan left open. It uses the same affected-stories rule as an
  unsharded build.
- **A shard cleans only its own output.** Before persisting, it deletes only the rendered rows of
  the `(story, target)` pairs it is about to write, never rows the plan inherited.
- **Completion is a reducer, by unique-claim insert.** The last shard to end inserts
  `<build>:finalize`; the single winner finalizes. No coordinator polls and `DatabaseAdapter` needs
  nothing beyond a unique-key insert.
  - A redelivered shard that is already `done` still reduces when its build is `capturing`, which
    covers a process that died between completing a shard and finalizing.
  - A finalize that throws releases its claim for the redelivery; on the last attempt it fails the
    build. A claim left `running` past five minutes is taken over; `finalizeBuild` is idempotent.
  - Only the finalizer closes the plan's attempt and posts the terminal status.
  - A shard row that is `done` is never moved by a later `markRunning`, `retry` or `fail`, so a
    crashing duplicate cannot undo it.
  - A failed build alerts once, not once per shard.
- **Progress is separate from logging.** A throttled `CaptureProgress` callback (at most one lease
  touch a second) is called per screenshot in the render loop and per snapshot in persistence,
  for build and shard jobs alike, so a healthy long shard or diff phase never reads as hung.
- **Cancellation is per run.** `RenderRequest.runId` is the shard id for a shard and the build id
  otherwise; a timeout, stall or lost lease cancels only that run (`CaptureRunner.cancel(buildId,
runId)`, tracked by runners with `RenderRuns`).

### 8. Crash isolation

A render call that throws loses its whole slice, so `renderIsolating` re-renders the stories the
crash never reached as two halves, recursively, until one story is left holding it. That story gets
one pass alone; if it crashes again it fails (`browser crashed: ...`) and its shard-mates are still
captured.

- A story counts as reached only once every one of its viewports has a capture or a failure, so a
  crash partway through a story renders it again, keeping the viewports already captured.
- Screenshots spooled before a crash are kept and take the environment of a later pass on the same
  target.
- The cost is about log2(n) passes per bad story. Past a pass cap the remaining stories fail
  unrendered.
- A crash that produces no screenshot at all is read as a broken environment, not a story's fault:
  it is rethrown and the job fails and retries through the queue. A browser launch failure is
  treated the same way (ADR 0007).
- The unsharded path shares the same render loop and isolation.

### 9. Forked capture

`testing.mode` is `"auto"`, `"in-process"` or `"fork"`. Forked capture is for operators who run
local engines on one machine: capture runs in a child process of the app.

- **Parent consumes, child renders.** The parent is the consumer of the database queue and pushes
  each leased job to the child over IPC as plain JSON (never adapter instances). The child's
  progress messages renew the lease, which the parent writes. The child never reads the queue.
  `runCaptureChild` is exported from `@storyshelf/core/capture`. The protocol is `run` and `cancel`
  from the parent (`cancel` makes the child call `runner.cancel` when the lease is lost or the job
  cancelled) and `progress`, `done` and `failed` from the child; the parent's `capture` handler
  (`createForkedCaptureHandler`) is registered on the app's one consumer. The child inserts the
  shard jobs a big build fans out into straight into the database queue, with the parent's
  `testing.retries` (`STORYSHELF_CAPTURE_RETRIES`).
- **Child bootstrap.** Adapters are live objects the user composes, so the child re-runs the user's
  module graph: `testing.workerEntry` when set, otherwise `process.argv[1]` with
  `STORYSHELF_ROLE=capture-worker` and a role guard above all import-time side effects (so it does
  not bind the port or run migrations). The child passes `tables` explicitly. The parent passes
  `testing.compare.threads` as `STORYSHELF_DIFF_WORKERS` and `testing.shardSize` as
  `STORYSHELF_CAPTURE_SHARD_SIZE` (the entry module's own `shardSize` wins). The concurrency slots
  live in the parent (`testing.concurrency`, a positive integer); the child runs whatever it is
  pushed.
- **The child is inside the app's trust boundary:** it holds the same database, storage and runner
  configuration. Notifications stay in the parent; the child reports outcomes.
- **Fallback to in-process capture** when `availableParallelism() < 2`, memory is below the
  threshold, `fork` is unavailable or throws, or the child crashes more than N times in T minutes.
  This is a real code path, not a configuration default, and it consumes the same queue, so
  tripping it mid-build keeps sharded builds working.
- **Crash handling.**
  - Any exit the parent did not ask for while work is pending or in flight is a crash, whatever its
    code, so a broken entry module trips the fallback instead of being re-forked forever.
  - A crash is charged only to the job that caused it (the hung receipt, or the only job in
    flight). Jobs that shared the crashed child go back uncharged and each runs alone next, so a
    repeat crash names its culprit.
  - A job whose last attempt crashed the child is failed by the parent's crash hook, which writes
    the failure the child could not: the build fails, or the shard row fails and the build is reduced as
    on any other shard's end. One limit, `testing.retries`, covers failed attempts, lost leases and
    child crashes.
  - A concurrency slot is taken before a job is leased, so no job is held that cannot start.
- On one host, sharding through a forked child buys granular retries, isolation and progress, not
  throughput.

### 10. Measurement

`scripts/bench-diff.mjs` times decode, `pixelmatch` and encode separately, with event-loop lag.
`scripts/bench-fixture.mjs` generates a synthetic Storybook and `scripts/bench-shards.mjs` runs a
real capture per configuration, reporting wall clock, peak memory and that every story was captured
exactly once (a row is invalid, and the exit code 1, unless the build ends approved with one
snapshot per story).

Measured on one 10-core, 64 GB host with a 600-story Chromium-only fixture (10% heavy stories):

| Configuration                     | Total pages | Wall    | vs unsharded | Peak RSS |
| --------------------------------- | ----------- | ------- | ------------ | -------- |
| Unsharded, 1 job                  | 8           | 97.8 s  | -            | 1.7 GB   |
| Sharded (100/shard), 1 worker x 8 | 8           | 103.5 s | +6%          | 1.8 GB   |
| Sharded, 2 workers x 4            | 8           | 94.1 s  | -4%          | 2.0 GB   |
| Sharded, 4 workers x 2            | 8           | 122.0 s | +25%         | 2.4 GB   |
| Sharded, 2 workers x 8            | 16          | 51.5 s  | 1.9x faster  | 3.1 GB   |
| Sharded, 4 workers x 8            | 32          | 37.5 s  | 2.6x faster  | 5.5 GB   |

- **Sharding is not a single-host speedup.** At equal total pages it costs -4% to +25%: each shard
  re-extracts the Storybook, starts its own static server and its own browser. Use it for scale-out
  and isolation.
- **Scale-out is sub-linear** on one host (CPU-bound at 32 pages). Rendering scales out through
  remote browsers (ADR 0007).
- **Longest-first ordering showed no wall-clock benefit** here: it tightened the spread between
  shards, but build time is bound by total page throughput.
- Not measured: multiple machines, Firefox or WebKit, multi-viewport builds, Postgres or MySQL, and
  Storybooks with far more variance in story cost.

## Consequences

**Positive**

- Diffing no longer stalls browser protocol traffic, so capture concurrency performs closer to its
  nominal setting.
- Hosting-only deployments carry no capture configuration.
- Granular retries, isolation of crashing stories and fine-grained progress follow from sharding.
- Environment changes migrate baselines on the default branch instead of flooding review, and are
  labelled on feature branches.
- Identical screenshots are stored once per project and never re-diffed.

**Negative**

- Sharding adds shard bookkeeping, a reducer and partial-build states: pure overhead for a small
  Storybook, hence the single-shard threshold and opt-in.
- Content addressing complicates retention, since blobs are shared across builds and baselines.
- Adaptive concurrency is harder to debug; it needs per-stage telemetry.
- A forked child doubles database connections and adds a second SQLite writer.
- A regression landing on the default branch together with an environment change is masked.

## Alternatives considered

| Option                                          | Why not                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Rewrite capture or diff in Rust or Go           | The browser renders in its own processes; Node mostly awaits IPC. Workers capture most of the codec gain           |
| Replace `pixelmatch` with `odiff`               | Different anti-aliasing and thresholds would invalidate baselines (ADR 0008)                                       |
| Auto-accept environment changes on every branch | Suppresses every diff until the default branch re-renders each story, which with affected capture may never happen |
| Reference counting for screenshot blobs         | Every delete path must stay balanced; one miss frees a live image                                                  |
| Per-object reuse claims on every dedupe hit     | Writes on exactly the path whose point is to write nothing                                                         |
| Decrement counter as the completion reducer     | Needs compare-and-swap from `DatabaseAdapter`; the unique-claim insert needs none                                  |
| Loopback HTTP self-enqueue                      | Lands in the same process unless another is listening; adds internal auth and no durability                        |
| Workers bootstrapping from serializable config  | Would remove constructed `database` and `storage` instances from the public API                                    |
| Per-project base viewports                      | Little gain, since screenshots are mostly of the content box                                                       |

## Open questions

- A separate compare stage, with its own queue and resource profile, so diffing can leave the
  rendering host. Not built.
- Whether finer shards shorten the tail of a sharded build, where idle workers wait on the last
  wave.
- Whether forked capture is retired once remote browsers are the recommended path (ADR 0006).
