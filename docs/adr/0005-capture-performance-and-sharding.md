# ADR 0005: Capture Performance and Sharding

## Status

Accepted

Supersedes (archived): ADR 0031

## Context

Capture (ADR 0004) and the pixel diff (ADR 0008) run in the app's Node process. Several structural
issues limit throughput and robustness:

1. **The diff blocks the event loop.** Decoding two PNGs, running `pixelmatch` and encoding the
   overlay is synchronous CPU work on the thread carrying browser protocol traffic. PNG codecs
   dominate; `pixelmatch` is a small fraction. The overlay was encoded even for passing diffs.
2. **The unit of work is the whole build.** One job capturing every story on every target caps
   parallelism at one process, makes a retry redo the build and makes progress coarse.
3. **One crashing story takes its neighbours with it.**
4. **Environment drift reads as visual change.**
5. **Screenshots are stored once per snapshot and baseline**, even when the bytes are identical.
6. **Capture configuration was spread** across top-level options and `config`, although capture is
   optional and a deployment may host Storybooks only.

## Decision

### 1. Diff performance

- **Byte-equal fast path:** hash both buffers; on a match, read width and height from the PNG
  header and return `passed` with zero changes and no overlay.
- **Lazy overlay:** run `pixelmatch` without an output buffer first; only a failing diff reruns
  with one and encodes the overlay.
- **Worker pool:** `diffImagesAsync` runs on a `worker_threads` pool owned by `@storyshelf/image`
  (ADR 0008). Default `max(1, availableParallelism() - 1)`, set by `testing.compare.threads`, `0`
  meaning in-thread. Buffers are transferred, not copied. A load failure or repeated crash falls
  back to the in-thread path without dropping a running diff and emits one process warning.
- **One call site:** `diffStoredScreenshots` serves capture persistence and re-diff.
- **Bounded re-diff:** `mapLimit`, never an unbounded `Promise.all`.

### 2. Page concurrency

- A Firefox or WebKit page counts as about two Chromium slots (published benchmarks measure them
  roughly 60-70 % slower).
- An adaptive controller raises in-flight pages while p95 latency and event-loop lag stay flat and
  backs off on timeouts. The latency baseline starts with the first timeout-free window.
- Remote targets are bounded by their preset's session cap instead (ADR 0007).

### 3. Scratch cleanup

A build's job extracts into `<build>/job/` and each shard into `<build>/shards/<shard>/`, so one
removal cannot reach another. Each removes its own directory in a `finally`, then the build's
directories if empty (`rmdir`, so a running duplicate is kept). Inline extraction cleans up the
same way, and a boot sweep removes directories orphaned by a crash. `config.scratchDir` defaults to
the OS temp directory.

### 4. API surface

All capture configuration lives under `ShelfOptions.testing` (ADR 0006): `runner`, `compare`,
`images`, `concurrency`, `shardSize`, `retries`, `storybookUrlRateLimit`, `queue`, `workerEntry`
and `mode`. Absent, the deployment hosts Storybooks only and tuning fields are unreachable rather
than ignored. `scratchDir` stays in `config` because publishing uses it too.

- **No aliases.** Old flat keys are removed, not deprecated; `ShelfConfig` is strict, so a stale
  key fails at boot.
- **Viewports stay global.** `config.viewports` is the default when neither Storybook nor story
  parameters set viewports; screenshots are mostly of the content box, so a per-project base set
  earns little.

### 5. Capture fingerprint and environment changes

Each snapshot records a capture fingerprint covering engine, browser build, platform, device scale
factor, a font digest, viewport and sizing defaults. Local targets read the host; remote targets
measure inside the browser (ADR 0007).

- **Compared per component, only where both sides know it.** A component a capture did not report
  (a runner that does not report it, screenshots spooled before a crash, a failed font probe) is
  unknown, not a change, and never overwrites a known baseline value.
- **Viewport is recorded but never a change:** its size comes from story parameters, so a new size
  is the change under review and diffs as a dimension change.
- **Any other component changing is an environment change**, recorded as `snapshots.env_change`:
  - **Default branch:** migration, no pixel diff; the snapshot is `unchanged`, and the baseline is
    rewritten with the new screenshot and fingerprint (`baselines.fingerprint`). A regression
    landing in the same build is masked; accepted trade-off.
  - **Any other branch:** still diffed; a difference is `changed` with the environment change
    attached, so review can say "probably the environment".
- **Pools should be homogeneous** (same image, architecture and fonts), or feature builds show
  noise until the default branch migrates.
- Baselines without a fingerprint are compared normally and backfilled.

### 6. Content-addressed screenshots

Screenshot blobs live at `<project>/content/<sha256>.png`: per project, so deletion and isolation
stay simple, and shared by snapshots and baselines (a baseline repoints instead of copying). An
upload is skipped when the bytes exist, and identical paths skip the diff without reading either
image. Older per-build and per-baseline files keep working. Storybook statics use a separate,
reference-counted scheme (ADR 0003).

Screenshots are reclaimed by **mark-and-sweep** in retention, not counters:

- An object no snapshot or baseline references is deleted after staying unreferenced across two
  sweeps at least 24 h apart. First-seen times live in `<project>/content/.sweep.json`; each
  candidate is re-checked against the database immediately before deletion.
- Reusing an object writes nothing, so the sweep cannot see the reuse. It defers deletion while
  reuse may be in flight: a build of the project is `pending`, `capturing` or `comparing` and was
  updated within the grace period, or a reuse claim
  (`<project>/content/.claims/<ulid>.json`, written by baseline import and by approving a legacy
  per-build snapshot) is younger than the grace period.
- Local storage writes through a temp file and a rename, so an interrupted write never leaves a
  torn file at a content address, and lists keys `/`-separated on every host.

### 7. Sharded capture

Sharding is opt-in through `testing.shardSize`; unset, a build is one job. A job with no shard
covers the whole build.

- **A shard** is a slice of a build's stories with all their targets and modes. A story's targets
  stay in one shard, so a newly enabled target can bootstrap from its sibling (ADR 0004).
- **Stages:** a `plan` job discovers stories, plans shards and enqueues one `render` job per shard
  on the database queue (ADR 0006). Shard rows live in `capture_shards` (kinds `plan`, `render`
  and a `finalize` claim row); each delivery is a `capture_jobs` row referencing its shard. Below
  the threshold the planner emits a single shard, so small Storybooks pay no overhead.
- **Planning:** without timing history, shards are contiguous slices of about `shardSize`
  captures. Runners report `RenderedSnapshot.durationMs`; when a build will shard, the plan reads
  per-story totals from the newest recent builds with timings (at most three) and packs
  longest-processing-time first. A story with no timing is priced at the average capture cost.
- **A plan replaces earlier plans:** it drops the build's earlier snapshots and cancels attempts
  an earlier plan left open, using the same affected-stories rule as an unsharded build.
- **A shard cleans only its own output:** it deletes only the rendered rows of the `(story,
target)` pairs it is about to write.
- **Completion is a reducer, by unique-claim insert:** the last shard inserts `<build>:finalize`
  and the single winner finalizes. A redelivered `done` shard still reduces while the build is
  `capturing`; a throwing finalize releases its claim for redelivery and fails on the last attempt;
  a `running` claim older than five minutes is taken over; `finalizeBuild` is idempotent. Only the
  finalizer closes the plan's attempt and posts the terminal status. A failed build alerts once.
- **Progress is separate from logging:** a throttled `CaptureProgress` callback (at most one lease
  touch a second) runs per screenshot and per persisted snapshot, so a healthy long shard never
  reads as hung.
- **Cancellation is per run:** `RenderRequest.runId` is the shard id or the build id; a timeout,
  stall or lost lease cancels only that run.

### 8. Crash isolation

A render call that throws loses its whole slice, so `renderIsolating` re-renders the stories the
crash never reached as two halves, recursively, until one story holds it. That story gets one pass
alone; if it crashes again it fails (`browser crashed: ...`) and its shard-mates are still captured.

- A story counts as reached only once every viewport has a capture or a failure, so a crash
  partway through a story renders it again, keeping captured viewports.
- Screenshots spooled before a crash are kept and take the environment of a later pass on the same
  target.
- Cost is about log2(n) passes per bad story; past a pass cap the remaining stories fail unrendered.
- A crash with no screenshot at all is a broken environment, not a story's fault: it is rethrown
  and the job retries through the queue. A browser launch failure is treated the same (ADR 0007).
- The unsharded path shares the same render loop and isolation.

### 9. Forked capture

`testing.mode` is `"auto"`, `"in-process"` or `"fork"`. Forked capture is for operators who run
local engines on one machine: capture runs in a child process of the app.

- **Parent consumes, child renders.** The parent consumes the database queue and pushes each leased
  job to the child over IPC as plain JSON (never adapter instances). The child's progress messages
  renew the lease, which the parent writes. The child never reads the queue. `runCaptureChild` is
  exported from `@storyshelf/core/capture`. The protocol is `run`/`cancel` from the parent and
  `progress`/`done`/`failed` from the child; `createForkedCaptureHandler` registers the parent's
  handler on the one consumer. The child inserts shard jobs directly, with `testing.retries`.
- **Child bootstrap:** adapters are live objects, so the child re-runs the user's module graph:
  `testing.workerEntry` when set, otherwise `process.argv[1]` with
  `STORYSHELF_ROLE=capture-worker` and a role guard above import-time side effects. The child
  passes `tables` explicitly. The parent passes `testing.compare.threads` and
  `testing.shardSize` as environment variables (the entry module's own `shardSize` wins).
  Concurrency slots live in the parent; the child runs what it is pushed.
- **The child is inside the app's trust boundary:** it holds the same database, storage and runner
  configuration. Notifications stay in the parent.
- **Fallback to in-process capture** when `availableParallelism() < 2`, memory is below the
  threshold, `fork` is unavailable or throws, or the child crashes more than N times in T minutes.
  This is a real code path, not a configuration default, and consumes the same queue.
- **Crash handling:** any unrequested exit while work is pending or in flight is a crash, whatever
  its code. A crash is charged only to the job that caused it (the hung receipt, or the only job in
  flight); jobs that shared the child go back uncharged and run alone next. A job whose last
  attempt crashed the child is failed by the parent's crash hook. One limit, `testing.retries`,
  covers failed attempts, lost leases and child crashes. A concurrency slot is taken before a job
  is leased, so no job is held that cannot start.
- On one host, sharding through a forked child buys granular retries, isolation and progress, not
  throughput.

### 10. Measurement

`scripts/bench-diff.mjs` times decode, `pixelmatch` and encode separately, with event-loop lag.
`scripts/bench-fixture.mjs` generates a synthetic Storybook and `scripts/bench-shards.mjs` runs a
real capture per configuration, reporting wall clock, peak memory and that every story was captured
exactly once (invalid and exit 1 unless the build ends approved with one snapshot per story).

Measured on one 10-core, 64 GB host with a 600-story Chromium-only fixture (10 % heavy stories):

| Configuration                     | Total pages | Wall    | vs unsharded | Peak RSS |
| --------------------------------- | ----------- | ------- | ------------ | -------- |
| Unsharded, 1 job                  | 8           | 97.8 s  | -            | 1.7 GB   |
| Sharded (100/shard), 1 worker x 8 | 8           | 103.5 s | +6 %         | 1.8 GB   |
| Sharded, 2 workers x 4            | 8           | 94.1 s  | -4 %         | 2.0 GB   |
| Sharded, 4 workers x 2            | 8           | 122.0 s | +25 %        | 2.4 GB   |
| Sharded, 2 workers x 8            | 16          | 51.5 s  | 1.9x faster  | 3.1 GB   |
| Sharded, 4 workers x 8            | 32          | 37.5 s  | 2.6x faster  | 5.5 GB   |

- **Sharding is not a single-host speedup.** At equal pages it costs -4 % to +25 %: each shard
  re-extracts the Storybook, starts its own static server and browser. Use it for scale-out and
  isolation.
- **Scale-out is sub-linear** on one host (CPU-bound at 32 pages). Rendering scales out through
  remote browsers (ADR 0007).
- **Longest-first ordering showed no wall-clock benefit** here: it tightened the spread between
  shards, but build time is bound by total page throughput.
- Not measured: multiple machines, Firefox/WebKit, multi-viewport builds, Postgres/MySQL, and
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

- Sharding adds bookkeeping, a reducer and partial-build states: pure overhead for a small
  Storybook, hence the single-shard threshold and opt-in.
- Content addressing complicates retention, since blobs are shared across builds and baselines.
- Adaptive concurrency is harder to debug; it needs per-stage telemetry.
- A forked child doubles database connections and adds a second SQLite writer.
- A regression landing on the default branch with an environment change is masked.

## Alternatives considered

| Option                                          | Why not                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Rewrite capture or diff in Rust or Go           | The browser renders in its own processes; Node mostly awaits IPC. Workers capture most codec gain |
| Replace `pixelmatch` with `odiff`               | Different anti-aliasing and thresholds would invalidate baselines (ADR 0008)                      |
| Auto-accept environment changes on every branch | Suppresses every diff until the default branch re-renders each story, which may never happen      |
| Reference counting for screenshot blobs         | Every delete path must stay balanced; one miss frees a live image                                 |
| Per-object reuse claims on every dedupe hit     | Writes on exactly the path whose point is to write nothing                                        |
| Decrement counter as the completion reducer     | Needs compare-and-swap from `DatabaseAdapter`; the unique-claim insert needs none                 |
| Loopback HTTP self-enqueue                      | Lands in the same process unless another is listening; adds internal auth and no durability       |
| Workers bootstrapping from serializable config  | Would remove constructed `database` and `storage` instances from the public API                   |
| Per-project base viewports                      | Little gain, since screenshots are mostly of the content box                                      |

## Open questions

- A separate compare stage with its own queue and resource profile, so diffing can leave the
  rendering host. Not built.
- Whether finer shards shorten the tail of a sharded build, where idle workers wait on the last
  wave.
- Whether forked capture is retired once remote browsers are the recommended path (ADR 0006).
