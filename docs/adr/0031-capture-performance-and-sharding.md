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
  `prepareTargetDir`, which resets the target *before* extracting.
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
  when `worker_threads` is unavailable (Deno, edge) or the worker fails to load.
  Switch `diffStoredScreenshots` in `capture/diff-record.ts` — the single call site
  for both `persistCapture` and `rediffBuild`.
- **Bound `rediffBuild`** with `mapLimit(rows, PERSIST_CONCURRENCY, ...)`.
- **Per-engine concurrency weights.** Count a Firefox or WebKit page as ~2 Chromium
  slots (ray.run cross-browser benchmarks on an 8-vCPU Ubuntu VM measured Firefox
  +70.8% and WebKit +59.6% against Chromium; several Playwright issues report worse
  WebKit ratios). Replace the static `recommendedPageConcurrency()` with an adaptive
  controller: raise in-flight pages while p95 capture latency and event-loop lag stay
  flat, back off on timeouts.
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
- Child must pass `tables` explicitly, since `createCaptureWorker` defaults to the
  `db-sqlite` schema handles.

### Phase 4 — Schema

- **Widen `infraHash` into a capture fingerprint** covering browser build, fonts,
  scale and viewport, so a mismatch registers as a migration event rather than a
  visual diff.
- **Content-address screenshot blobs**, reusing the `content/<hash>` + manifest +
  ref-tracking pattern `persistStorybookStatics` already uses for statics. Unchanged
  stories then need no upload, no decode and no diff.

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

| Option | Why not |
|---|---|
| Rewrite capture or diff in Rust/Go | Chromium renders in its own processes; Node mostly awaits IPC. `sharp` (libvips) plus workers captures most of the codec gain without a second toolchain. |
| Replace `pixelmatch` with `odiff` | Different anti-aliasing and threshold behaviour would invalidate existing baselines. A deliberate migration at best, not a drop-in. |
| Database-backed queue | Deployments may use Postgres or MySQL; the queue must not constrain the database adapter. |
| Loopback HTTP self-enqueue | Lands in the same process unless a second one is already listening — in which case IPC is the better transport. Adds internal auth, request timeouts and no durability. |
| `connectOverCDP` | Chromium only, and Playwright documents it as significantly lower fidelity than `browserType.connect()`. |
| Remote browser server (`run-server`) sidecar | Client and server must share the same major.minor Playwright version, coupling releases to a browser image. Keep as an opt-in endpoint option, not the default. |
| Managed grids (Browserless, Azure Playwright Workspaces) | A self-hosted product should not require a SaaS browser fleet. Optional at most. |
| Workers bootstrapping from serializable config | Would remove constructed `database`/`storage` instances from the public API — the best property it has. The role-flag re-entry is less elegant and keeps the API simple. |

## Open questions

- Does `db-sqlite` set WAL and a busy timeout? A forked child adds a second writer.
- Reducer idempotency under at-least-once delivery needs a deliberate test, not just
  a race-free happy path.
- Whether the Phase 1 thread pool should be owned by the app (so re-diff can use it in
  queue-only deployments) or by the capture worker.

## Validation

- Parity: existing `diff/engine.test.ts` cases pass for sync and pooled backends, with
  a test asserting identical output across them.
- Pool: worker crash, task error propagation, `workers=0` fallback, clean shutdown.
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
