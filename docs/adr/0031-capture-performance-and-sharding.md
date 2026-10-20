# ADR 0031: Capture Performance, API Surface, and Sharded Capture

## Status

Proposed

## Context

The capture path (ADR 0003) and the pixel diff engine (ADR 0004) currently run in a
single Node process. Three structural issues limit throughput:

1. **The diff blocks the event loop.** `diffImages` in `core/src/diff/engine.ts` is
   fully synchronous: `PNG.sync.read` x2, `pixelmatch`, then `PNG.sync.write`.
   `persistCapture` runs it with `PERSIST_CONCURRENCY`, but on one thread that is
   still serial CPU work, and it stalls the same event loop that carries Playwright's
   protocol traffic. In the `mizchi/pixelmatch` port's published benchmarks, PNG
   encode/decode accounts for 97-99% of diff-pipeline time, with pixelmatch itself a
   small fraction. The diff overlay is also encoded for every snapshot even though
   `writeDiffOverlay` discards it when the diff passes.

2. **The unit of work is the whole build.** One job captures every story on every
   engine. That caps parallelism at one machine, makes retries re-do entire builds,
   and makes progress coarse.

3. **Public API complexity.** Capture spans both `ShelfOptions` (`captureRunner`,
   `captureQueue`) and `ShelfConfig` (`scratchDir`, `viewports`,
   `captureConcurrency`), even though capture is optional — a deployment may be
   Storybook hosting only.

Secondary findings from the audit:

- `rediffBuild` uses an unbounded `Promise.all` over every snapshot in a build.
- Nothing removes a build's scratch directory after capture; the only `rm` is
  `prepareTargetDir`, which resets the target _before_ extracting.
- `config.viewports` is deployment-wide, but base viewports are a per-project
  concern, and viewport name is part of baseline identity. `projects.modesAllowlist`
  is the precedent for per-project capture policy living in the database.
- Compare is not capture-only: `POST /api/v1/projects/{slug}/builds/{buildId}/rediff`
  decodes and compares stored screenshots with no browser involved.
- `persistStorybookStatics` already implements content-addressed storage
  (`content/<hash>` keys, per-build `manifest.json`, ref tracking for GC).

## Decision

Adopt the plan below in five phases. Phases 1-3 are independent. Phase 4 lands
before Phase 5 so shards write into the final storage model. Only Phase 5 is a
breaking change.

### Phase 0 — Measure (prerequisite)

Add a benchmark script under `scripts/` that runs `diffImages` over fixture
screenshots at several sizes, timing decode, `pixelmatch` and encode separately, plus
event-loop lag via `perf_hooks.monitorEventLoopDelay`. Phase 1 is sized off this. If
the codec does not dominate here, revisit the premise before building the pool.

### Phase 1 — Performance, no API change

- **Byte-equal fast path.** Hash both buffers first; on a match read width and height
  from the PNG header (IHDR, bytes 16-23) and return `passed: true`, zero pixels,
  `diffImage: null`. Opportunistic: it only helps when renders are byte-identical.
- **Lazy overlay encoding.** Run `pixelmatch` with a `null` output buffer first; only
  when the result fails, rerun with an output buffer and encode.
- **`diffImagesAsync`** backed by a `worker_threads` pool (`src/diff/worker.ts` as a
  new `tsdown` entry, resolved via `new URL("./worker.mjs", import.meta.url)`).
  Default size `max(1, availableParallelism() - 1)`, overridable, `0` meaning
  in-thread. Transfer `ArrayBuffer`s rather than copying. Fall back to the sync path
  when `worker_threads` is unavailable (Deno, edge) or the worker fails to load. A
  worker dying before `ready` is a load failure only while no worker has ever started;
  after that it is a crash, and the pool gives up only after three in a row. Falling
  back never drops a running diff (a busy worker finishes before it stops) and emits
  one `STORYSHELF_DIFF_POOL_FALLBACK` process warning.
  Switch `diffStoredScreenshots` in `capture/diff-record.ts` — the single call site
  for both `persistCapture` and `rediffBuild`.
- **Bound `rediffBuild`** with `mapLimit(rows, PERSIST_CONCURRENCY, ...)`.
- **Per-engine concurrency weights.** Count a Firefox or WebKit page as ~2 Chromium
  slots (ray.run cross-browser benchmarks on an 8-vCPU Ubuntu VM measured Firefox
  +70.8% and WebKit +59.6% against Chromium; several Playwright issues report worse
  WebKit ratios). Replace the static `recommendedPageConcurrency()` with an adaptive
  controller: raise in-flight pages while p95 capture latency and event-loop lag stay
  flat, back off on timeouts. The latency baseline comes from the first window without
  a timeout, so a timeout in the first window cannot inflate it.
- **Leases on the in-process transport**, so crash recovery is one mechanism across
  all queue transports.
- **Scratch cleanup.** Remove the build's scratch directory in a `finally` after
  capture and after inline extraction, plus a boot sweep for crash-orphaned dirs.

### Phase 2 — API surface

- **Nest capture.** `capture?: { runner, queue, mode, concurrency, workerEntry }`.
  Absent means hosting-only, which makes the tuning fields unreachable rather than
  silently ignored. `setupCaptureQueue` already returns
  `{ queue: null, enqueueCapture: undefined }` in that case, so this makes the type
  express existing behaviour.
- **Keep `scratchDir` top-level** — the upload path uses it for inline statics
  extraction, which is the hosting path — and default it to
  `path.join(os.tmpdir(), "storyshelf")`, removing the "scratchDir is not set" throw.
  Only safe once Phase 1 cleanup lands, since `/tmp` is memory-backed on some hosts
  and small on constrained platforms.
- **Separate `compare?: { engine, threads }`.** Required by the re-diff route in
  queue-only deployments where the server never renders. The thread pool's lifecycle
  belongs to the app, not the capture worker.
- **Group notifications.** `notifications?: { notifiers, emailSender, config }` replaces
  `notifiers`, `emailSender` and `config.notifications`, so the one breaking change
  covers the whole subsystem.
- **Breaking, no aliases.** The old flat keys (`captureRunner`, `captureQueue`,
  `config.captureConcurrency`, `notifiers`, `emailSender`, `config.notifications`) are
  removed outright rather than deprecated; `ShelfConfig` is strict, so a stale key
  fails at boot instead of being ignored.
- **`viewports` stay global.** Not moved to a project setting: `config.viewports` is the
  default when neither Storybook nor story parameters configure viewports, and
  screenshots are taken of the content box rather than the whole viewport in most
  cases, so a per-project base set earns little. `compare.engine` is also left out,
  since pixelmatch is the only engine.

### Phase 3 — Process boundary

- **`ForkedCaptureQueue implements CaptureQueue`** (parent) keeps the `entries` map so
  `status`/`active`/`recent` keep answering the UI; `enqueue` sends over IPC.
- **`IpcCaptureQueue implements PollableCaptureQueue`** (child) does `poll`/`ack`/
  `nack` over `process.send`. `@storyshelf/worker` consumes this interface already, so
  the worker loop is unchanged. Messages are plain JSON; never adapter instances.
- **No database-backed queue** — deployments may use Postgres or MySQL, and the queue
  must stay transport-only.
- **Child bootstrap.** Adapters are live objects the user composes, so the child
  re-runs the user's module graph: explicit `capture.workerEntry`, else fork
  `process.argv[1]` with `STORYSHELF_ROLE=capture-worker` and a role guard above all
  import-time side effects (so it does not bind the port or re-run migrations).
- **Fallback to `InMemoryCaptureQueue`** when `availableParallelism() < 2`, memory is
  below threshold, `fork` is unavailable, the fork throws, or the child exits
  non-zero more than N times in T minutes. A real code path, not a config default.
- **Crash handling.** Parent watches `exit`, requeues in-flight jobs with incremented
  `attempts`, fails the build past `maxRetries`. Leave `leaseMs` unset so child
  liveness is the lease. Notifications stay in the parent; the child reports outcomes.
  Refinements from the post-merge review:
  - A job failed for crashing the child settles with `crashed: true`, and the parent
    writes the failure the child never could (`failCrashedCapture`): the build fails
    with a failure status, or a shard's row fails through `CaptureShardModel.fail` and
    the build is reduced as on any other shard's end. The alert then reads the status.
  - A crash is charged only to the job that caused it: the hung receipt, or the only
    job in flight. Jobs that shared a crashed child go back uncharged and each runs
    alone next, so a repeat crash names its culprit.
  - Any exit the parent did not ask for while work is pending or in flight counts as a
    crash, whatever its code, so a broken entry module that returns at once trips the
    fallback instead of being re-forked forever.
  - A requeue waiting out its backoff starts a child when it lands, or goes to the
    fallback if the queue tripped meanwhile.
  - The worker takes a slot before it polls, so it never holds a job it cannot start
    (whose lease would kill the child, or whose remote visibility would lapse).
  - A final failure is a `nack { requeue: false, error }`, so forked views show it
    `failed` with its error; SQS and Redis drop the message as an ack would.
  - `compare.threads` reaches the child as `STORYSHELF_DIFF_WORKERS`, and
    `capture.concurrency` must be a positive integer.
- Child must pass `tables` explicitly, since `createCaptureWorker` defaults to the
  `db-sqlite` schema handles.

### Phase 4 — Schema

- **Widen `infraHash` into a capture fingerprint** covering engine, browser build,
  host platform, device scale factor, a digest of the system fonts, viewport and sizing
  defaults. The components are compared against the baseline's one by one, and only
  where both sides report a value: a component a capture did not report (a runner that
  does not report it, screenshots spooled before a browser crash, a failed `fc-list`) is
  unknown, not a change, and is never written over a known value on the baseline.
  Viewport is recorded but never counts as a change: its size comes from story
  parameters, so a new size is the PR's own change and diffs as a dimension change. A
  change in any other component is an **environment change**, recorded on the snapshot
  (`snapshots.env_change`):
  - On the **default branch** it is a **migration**: no pixel diff is computed, the
    snapshot is accepted (`unchanged`) and the baseline is rewritten with the new
    screenshot and fingerprint (`baselines.fingerprint`). Kept because the default branch
    is authoritative and auto-approves its own changes anyway; the diff would only change
    the status label. Trade-off accepted: a regression landing on the default branch in
    the same build as an environment change is masked.
  - On **any other branch** the snapshot is still diffed, and a difference is `changed`
    (review required) with the environment change attached, so the review page can say
    "probably the environment". Auto-accepting here was rejected: it suppressed every
    diff on every branch until the default branch re-rendered each story, which with
    affected capture (unaffected stories never re-render) could last indefinitely, and
    with a mixed worker pool happened constantly. A capture pool should therefore be
    homogeneous (same image, arch and fonts), or feature builds will show environment
    noise until the default branch migrates.

  Baselines from before fingerprints are compared normally and backfilled. This replaces
  the unused `projects.automigrate` flag's size-change special case.
- **Content-address screenshot blobs** as `<project>/content/<sha256>.png`: per project (not
  global, so project deletion and isolation stay simple), shared by snapshots and
  baselines (a baseline repoints instead of copying), and skipped on upload when the
  bytes already exist. Identical paths mean identical bytes, so the diff is skipped
  without reading either image. Unlike statics, which count references in
  `content_refs`, screenshots are reclaimed by **mark-and-sweep** in the retention
  purge: an object no snapshot or baseline references is deleted once it has stayed
  unreferenced across two sweeps at least 24 h apart (first-seen times live in
  `<project>/content/.sweep.json`, so no schema change and no storage `stat`), and each
  candidate is re-checked against the database immediately before deletion. Reusing an
  object that already exists writes nothing, so the sweep cannot see it in storage; a
  capture may hold such a reuse for minutes or hours before its snapshot rows land. The
  sweep therefore defers every deletion in a project while reuse may be in flight: a
  build of the project is `pending`, `capturing` or `comparing` (and was updated within
  the grace period, so a stuck build delays reclaiming storage but never blocks it for
  good), or a reuse claim (`<project>/content/.claims/<ulid>.json`, written by baseline
  import and by approving a legacy per-build snapshot around their store-then-write-rows
  step) younger than the grace period exists. Per-object claims on every dedupe hit
  were rejected: they would write on exactly the path whose point is to write nothing.
  Local storage writes through a temp file and a rename, so a write cut short never leaves
  a torn file at a content address (an existing object is trusted, so a torn one would be
  reused by every later capture of those bytes), and lists keys `/`-separated on every
  host. Counters
  would need every delete path (builds, baselines, imports, project delete) to stay
  balanced, and a miss frees a live image. Older per-build and per-baseline files keep
  working and are cleaned up as before.

### Phase 5 — Sharded capture (breaking)

- **Job becomes a shard:** `(buildId, engine, story-range, mode group)`. A job
  carrying only `buildId` means one shard covering the build, so existing queue
  adapters and external workers keep working.
- **Stages as a job field:** plan, render, compare. Single-server runs them in one
  worker; at scale, render and compare get separate queues with different resource
  profiles.
- **Build completion becomes a reducer:** each shard atomically decrements a remaining
  count and whoever hits zero flips the status. No coordinator polling.
- **Poison-shard isolation:** a story that crashes a browser is retried alone on a
  fresh browser, then marked errored, without failing its shard-mates.
- **Longest-first shard ordering** from per-story historical durations.
- The planner emits a single shard below a size threshold, so small Storybooks do not
  pay sharding overhead.

**Implemented (first slice).** Plan + render stages, `capture_shards` table
(`plan` / `render` rows plus a `finalize` claim row), the planner (contiguous slices,
a story's engines kept together), optional `shard` field on queue jobs and transports,
and the reducer as a **unique-claim insert** rather than a decrement (no
`DatabaseAdapter` change): the last shard to end inserts `<build>:finalize`; the single
winner finalizes. Opt-in via `capture.shardSize` / worker `shardSize`; unset keeps
today's one-job behaviour. Not yet done: a separate compare stage/queue.

**Longest-first ordering (third slice).** Runners report `RenderedSnapshot.durationMs`
and it is persisted per snapshot (`snapshots.duration_ms`, nullable; third-party runners
that report none keep working). The plan stage reads the per-story totals of the newest
recent build that carries timings (`capture/shards/history.ts`, at most three builds
scanned, and only once the plan knows the build will shard) and passes them to `planShards`, which switches from contiguous slices to
longest-processing-time packing: dearest stories placed first, each into the shard with
the least work that still has room for its captures, shards handed to the queue heaviest
first. A story with no timing is priced at the average cost of a capture. Capture
capacity still binds, so shards stay about `shardSize`; with no timings at all (fresh
project, purged history) the contiguous slicing is unchanged.

**Forked capture (fourth slice).** The forked child already had an `enqueue` message
that puts a job on the parent's queue, so a child that plans a build hands its shards
back over IPC and the parent delivers them to the same child like any other job (queue
entries, receipts, leases and crash redelivery are keyed per shard, and a requeued shard
stays a shard). What was missing was configuration: the parent now passes
`capture.shardSize` to the child in `STORYSHELF_CAPTURE_SHARD_SIZE` (the entry module's
own `shardSize` wins), and `capture.shardSize` together with `capture.workerEntry` is no
longer rejected. The in-process fallback shards through the same queue, so tripping it
mid-build keeps working. Because every shard settles as its own job, the parent alerts a
failed build once per failure instead of once per shard. A single child still renders one
shard at a time per its concurrency, so this buys granular retries, isolation and
progress on one host rather than throughput; horizontal scale remains a remote queue.

**Poison-shard isolation (second slice).** A render call that throws takes its whole
slice with it, so `renderIsolating` (`capture/isolate.ts`) re-renders the stories the
crash never reached as two halves, and so on until one story is left holding it. That
story gets one pass on its own first, and only if it crashes there too is it failed
(`browser crashed: …`); its shard-mates are still captured. A story counts as reached
only once every one of its resolved viewports has a capture or a failure, so a crash
partway through a story's viewports renders it again (the viewports it already captured
are kept once) instead of silently losing the rest. Screenshots spooled before the crash are kept and inherit the capture
environment of a later pass on the same engine. Halving costs about log2(n) passes per
bad story instead of a browser per story, with a pass cap beyond which the stories left
are failed unrendered. A crash that never produces a single screenshot is read as the
environment being broken rather than any story's fault: it is rethrown, and the shard
fails as before (the queue retries it, and its final failure fails its stories). This
also covers the unsharded path, which shares the render loop.

**Review fixes (fifth slice).** A review of the merged work found the shards and the
reducer assumed one render per build at a time, and that only a completing shard would
ever reduce. Behaviour since:

- A shard's cleanup before it persists deletes only the **rendered** rows of the
  `(story, engine)` pairs it is about to write, never the plan's inherited rows (a build
  that renders a newly enabled engine keeps the primary engine's inherited snapshots).
- **Progress is separate from logging.** A `CaptureProgress` callback (`capture/progress.ts`,
  throttled to one lease touch a second) is threaded through shard execution, the render
  loop (one call per screenshot) and the persist phase (one call per snapshot, inherited
  ones included), and dispatch builds it from the job's lease for build and shard jobs
  alike. Healthy long shards and long diff phases no longer read as hung; attempt-log
  lines still touch the lease too.
- **Render cancellation is per run.** `RenderRequest.runId` (the shard id for a shard,
  the build id otherwise) and `CaptureRunner.cancel(buildId, runId?)`: a timeout, stall
  or lost lease cancels only that run, and a cancel without a run id stops every render
  of the build. Runners track their calls with `RenderRuns` (`@storyshelf/core/adapter/capture-runner`).
- **The build always reaches an owner of "finished".** A redelivered shard that is already
  `done` still reduces when its build is `capturing`, so a worker that died between
  completing the shard and finalizing is covered. A finalize that throws releases its
  claim row for that redelivery; on a last try it fails the build instead. A claim left
  `running` past five minutes (a worker that died mid-finalize) is taken over; a finished
  one is marked `done`. `finalizeBuild` is idempotent, so a second finalize is harmless.
- **Only the finalizer closes the plan's attempt** (and posts the terminal status), with
  its counts, through `ShardRunInput.onFinalized`; a shard that fails after another run
  finalized, or while siblings are open, leaves the attempt alone.
- The plan uses the same `affectedPathsFor` rule as the unsharded path (a build that did
  not opt into affected capture renders everything), and a new plan of a build first drops
  the build's earlier snapshots and cancels the attempts an earlier plan left open.

### Measured: sharded capture on one host

`scripts/bench-shards.mjs` runs a real capture (db-sqlite, local storage, the Playwright
runner, the in-memory queue) of one built Storybook per configuration and reports
enqueue-to-finished wall clock, peak resident memory of the process and its browsers,
and a check that every story was captured exactly once. One 10-core, 64 GB Mac, a
synthetic 600-story Storybook (React, 1 viewport, a fixed 500 ms per-story settle, 10%
of stories heavy: 4000-cell grid and a 1.5 s `play`), Chromium only, 2 repeats (3 for the
ordering runs). "Pages" is Playwright page concurrency per render call; `workers x pages`
is what the host runs at once. To reproduce: `scripts/bench-fixture.mjs` generates the
Storybook (`--heavy even` for the configuration table, `--heavy first --heavy-count 90`
for the ordering runs) and `scripts/bench-shards.mjs` runs it; a row is marked invalid
and the exit code is 1 unless the build ends approved with one snapshot per story.

| Configuration                     | Total pages | Wall    | vs unsharded | Peak RSS |
| --------------------------------- | ----------- | ------- | ------------ | -------- |
| Unsharded, 1 job                  | 8           | 97.8 s  | -            | 1.7 GB   |
| Sharded (100/shard), 1 worker x 8 | 8           | 103.5 s | +6%          | 1.8 GB   |
| Sharded, 2 workers x 4            | 8           | 94.1 s  | -4%          | 2.0 GB   |
| Sharded, 4 workers x 2            | 8           | 122.0 s | +25%         | 2.4 GB   |
| Sharded, 2 workers x 8            | 16          | 51.5 s  | 1.9x faster  | 3.1 GB   |
| Sharded, 4 workers x 8            | 32          | 37.5 s  | 2.6x faster  | 5.5 GB   |

What this says, and what it does not:

- **Sharding is not a single-host speedup.** At equal total pages it costs between -4%
  and +25%, smallest at one or two workers and visible at four. Each shard re-extracts
  the Storybook, starts its own static server and launches its own browser, and more
  browsers compete for the same cores; these are the likely causes and were not
  separated by measurement (browser launch, CPU contention and SQLite write contention
  would each fit the numbers). Use it for scale-out and isolation, not to speed up one
  machine.
- **Scale-out works but is sub-linear.** Doubling and quadrupling the pages gave 1.9x
  and 2.6x. The 32-page run is CPU-bound on this host (and uses 5.5 GB); a fleet of
  separate machines would not share that ceiling, but that is not measured here.
- **Longest-first ordering showed no wall-clock benefit on this setup.** On a fixture
  with the slow stories clustered together, the timed plan tightened the spread between
  the fastest and slowest shard (35.5-40.9 s down to 36.3-37.5 s in two of three runs)
  but build time stayed at about 112 s (mean 112.8 s untimed vs 116.7 s timed, one timed
  run an unexplained 126.6 s outlier). The wall clock here is bound by total page
  throughput, and with 10 shards on 4 workers the last wave leaves two workers idle
  whatever the order. That is a hypothesis about the tail, not a measured result; finer
  shards would be the thing to try next.
- **Not measured:** multiple machines, Firefox/WebKit, multi-viewport builds, Postgres
  or MySQL, and a Storybook where story cost varies far more than 10% heavy.

The benchmark also found a bug: the plan job removed the build's whole scratch directory
after enqueueing its shards, which could delete the directory of a worker that had
already started extracting (one failed shard in the first matrix). The build's own job
(the plan, or the whole build when it is not sharded) now extracts into `<build>/job/`,
beside `<build>/shards/<shard>/`, so removing one can never reach the other, including
when the plan fails after handing shards out. Each shard removes its own directory and,
if that leaves the build's directories empty, those too (`rmdir`, so a directory that
still holds a running duplicate of a finished shard is kept). A shard row that is already
`done` is no longer moved by `markRunning`, `retry` or `fail`, so a redelivered duplicate
that crashes cannot undo it.

## Consequences

**Positive**

- Diffing stops stalling Playwright's protocol traffic, which should also make
  existing capture concurrency perform closer to its nominal setting.
- `createShelfApp` gains one nested group and loses a required field; hosting-only
  deployments stop carrying capture configuration they never use.
- Horizontal scale, granular retries and streaming progress all follow from sharding.
- Per-project viewports fix the multi-project case and stop server config silently
  renaming baselines across every project.

**Negative**

- Sharding adds shard bookkeeping, a reducer and partial-build states to the UI —
  pure overhead for a 50-story Storybook, hence the single-shard threshold.
- Content addressing complicates retention and GC, since blobs are shared across
  builds and baselines.
- Adaptive concurrency is harder to debug when someone reports a performance problem;
  it needs legible per-stage telemetry.
- A forked child doubles database connections and adds a second SQLite writer.
- An optional native image backend, if added later, makes parity tests mandatory.

## Alternatives considered

| Option                                                   | Why not                                                                                                                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rewrite capture or diff in Rust/Go                       | Chromium renders in its own processes; Node mostly awaits IPC. `sharp` (libvips) plus workers captures most of the codec gain without a second toolchain.                |
| Replace `pixelmatch` with `odiff`                        | Different anti-aliasing and threshold behaviour would invalidate existing baselines. A deliberate migration at best, not a drop-in.                                      |
| Database-backed queue                                    | Deployments may use Postgres or MySQL; the queue must not constrain the database adapter.                                                                                |
| Loopback HTTP self-enqueue                               | Lands in the same process unless a second one is already listening — in which case IPC is the better transport. Adds internal auth, request timeouts and no durability.  |
| `connectOverCDP`                                         | Chromium only, and Playwright documents it as significantly lower fidelity than `browserType.connect()`.                                                                 |
| Remote browser server (`run-server`) sidecar             | Client and server must share the same major.minor Playwright version, coupling releases to a browser image. Keep as an opt-in endpoint option, not the default.          |
| Managed grids (Browserless, Azure Playwright Workspaces) | A self-hosted product should not require a SaaS browser fleet. Optional at most.                                                                                         |
| Workers bootstrapping from serializable config           | Would remove constructed `database`/`storage` instances from the public API — the best property it has. The role-flag re-entry is less elegant and keeps the API simple. |

## Open questions

- Does `db-sqlite` set WAL and a busy timeout? A forked child adds a second writer.
- Reducer idempotency under at-least-once delivery needs a deliberate test, not just
  a race-free happy path.
- Whether the Phase 1 thread pool should be owned by the app (so re-diff can use it in
  queue-only deployments) or by the capture worker.

## Validation

- Parity: existing `diff/engine.test.ts` cases pass for sync and pooled backends, with
  a test asserting identical output across them.
- Pool: worker crash, task error propagation, `workers=0` fallback, clean shutdown,
  a pre-ready death beside a busy worker.
- Fast path: equal buffers return correct dimensions and no overlay; different buffers
  do not take it.
- Queue: one shared `CaptureQueue` contract suite run against in-memory, forked and
  Redis implementations.
- Fork: each fallback trigger selects the in-memory queue; killing the child mid-job
  requeues once and fails after `maxRetries`; no orphaned child after `SIGTERM`.
- Integration: `capture/pipeline.test.ts` and `capture/rediff.test.ts` stay green, with
  re-diff asserting bounded concurrency.

## References

- ADR 0003 (capture), ADR 0004 (pixel diff engine), ADR 0028 (modes and multi-browser)
- Playwright Docker docs: `--init`, `--ipc=host`, sandbox and seccomp guidance
- Playwright `browserType.connect()` version-matching requirement
- microsoft/playwright#33566 (headless shell since v1.49), #1396 (launch timings)
