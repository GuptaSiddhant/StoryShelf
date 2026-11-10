# Capture queue

> Part of the [StoryShelf architecture spec](./README.md).

## Capture Queue

Capture is CPU/IO-heavy and long-running (minutes to tens of minutes). It must not block the upload request:

- `POST /builds` stores the zip and returns **202 Accepted** immediately.
- The job goes on the **database queue** (`capture_jobs`, below). Every instance with `testing` consumes it, with a **configurable concurrency** (`testing.concurrency`, auto-sized by default).
- A user can cancel a build that is `pending`, `capturing` or `comparing` (`POST …/builds/:id/cancel`, **Cancel build** on the build page): its jobs of every kind are cancelled, a running capture stops within the 5 s cancel check, and the build ends `cancelled` (a status of its own, terminal: later status writes from the capture path are refused, a retry resets it; `build:cancelled` is the event, git channels show it as `cancelled`). The MCP server does not expose it.
- There is no boot sweep. A build left `capturing` by a killed instance is recovered by lease expiry: another instance claims the job again, and if every attempt (`testing.retries + 1`) is lost the job becomes `exhausting` and `onExhausted` fails the build (`failCrashedCapture`: the attempt closes, the build becomes `failed`, a failure git status is posted, admins are alerted), so a crash loop cannot repeat captures forever and a second instance can boot without touching the first one's builds. A hook run is itself a leased attempt: one that throws or dies is re-run by any instance after its lease, five runs at most, and then the job fails and admins are alerted that the build may be stuck.

### Database queue (`capture_jobs`)

`createDatabaseCaptureQueue(db, options)` (`@storyshelf/core/capture`, `core/src/capture/db-queue/`)
is a `PollableCaptureQueue` on the app's own database and the app's only production queue (ADR 0006;
there is no in-memory queue). The claim algorithm needs only one primitive from
the adapter, a unique-key insert whose conflict can be told apart (the `claimFinalize` pattern):

1. **Probe.** One query, `kind = ? AND visible_at <= now AND status IN ('queued','running') ORDER BY
   visible_at LIMIT 1`, a range scan of `capture_jobs_poll_idx`. Only candidates have a
   `visible_at` (a queued job, a running attempt whose lease is its `visible_at`), so an idle probe
   reads no rows and a busy one reads one.
2. **Claim.** Insert attempt row `<jobId>:<n+1>` (owner, lease). Exactly one instance wins; the
   winner re-reads the job (a cancel or a late finish between probe and insert gives the claim
   back), marks an expired attempt it replaced `expired`, and marks the job row `running`. A loser
   whose winner died before that mark claims the winner's attempt once its lease expires, and until
   then moves the job row's `visible_at` behind that lease (never its status).
3. **Hold.** The holder writes only its own attempt row: `extend` renews the lease (the write
   returns the row, so `expired` means lost and a cancel flag means cancelled) and reads the job
   row; `inspect` reads the job row every 5 s without renewing. `keepJobLease` renews on a heartbeat
   timer (`min(30 s, lease / 3)`) and on progress while the handler is alive, so a silent stage
   keeps its lease and a dead holder's lease expires; the lease is `testing.leaseSeconds`
   (default 300).
4. **Finish.** `ack` marks the attempt and the job `done`. `nack` is ignored from a superseded
   holder; otherwise it requeues with a delay (`visible_at`), or fails the job past `max_attempts`
   or with `requeue: false`, or ends it `cancelled` when flagged. A final attempt that loses its
   lease moves the job to `exhausting` instead (one limit covers failures and lost leases): the
   host's `onExhausted` hook runs under a lease, five runs at most, and then the job fails.
5. **Cancel.** `cancel(jobId | buildId)` ends a queued job at once and flags a running one on its
   job and attempt rows; a build id covers every job kind of the build (capture, publish, notify).

**Consumer** (`createCaptureConsumer`, `core/src/capture/consumer/`). Consumes any
`PollableCaptureQueue` (this queue and the IPC queue of a forked child) and runs a
handler per job `kind`: `capture` is wired to `createDispatchJob`; `publish` and `notify` register
through `handlers`; a job whose kind has no handler is failed with `no handler registered for job
kind "<kind>"`. A slot is taken before polling (the database queue uses `startPollLoop`, other
queues a slot loop with the idle backoff of 250 ms doubling to 5 s for queues that return empty at
once). A failing job is requeued with delay `1000 ms * 2^attempts` (capped at 30 s) until its last
attempt (a handler may state its own `backoff`, and a job its own `maxAttempts`), `attempt >= maxAttempts` for the database queue (`attempts >= maxRetries` for queues that
only count deliveries), then nacked without requeue so it ends `failed`; the constants live in
`consumer/retry.ts`. The lease is kept by heartbeat and progress (`keepJobLease`): a lost lease or a `cancelled`
reading stops the run through `runner.cancel(buildId, shard)`; a lost lease writes nothing (the
new holder settles the job), a cancel ends the job `cancelled`. `stop()` (SIGTERM) stops polling
and waits for the jobs in flight; the runners launch browsers with `handleSIGINT`/`handleSIGTERM`/`handleSIGHUP` off, so the signal does not close a browser under a capture that is still draining (each render closes its own). Optional `metrics` hooks report each job's outcome and the
queue's depth and oldest waiting job (a sample costs one read; off unless `queueSample` is given).

**In the app** (`packages/app/src/jobs-setup.ts`). One lazily built database queue carries the `capture` jobs (only when `testing` has a `runner`) and the `publish` jobs (only on a long-running host, not a serverless one) and one consumer runs them: the `capture` handler (`capture-setup.ts`: `createCaptureHandler`, wrapped to alert admins when a capture leaves its build failed), the `publish` handler (`publish-setup.ts`); `notify` jobs run on a second queue and consumer over the same `capture_jobs` table (long-running hosts only; a serverless host has none), with their own retry limit (`NOTIFY_MAX_ATTEMPTS`; see PR Status Checks & Merge Gate), kept apart so a status never waits behind a capture (`queuesFor` in `jobs-setup.ts`). The consumer starts when adapters are ready and `teardown()` drains it. `DatabaseCaptureQueueOptions.onExhausted` is the hook the queue offers its host: a job whose final attempt lost its lease has no running handler to record the failure, so the host writes it (the crash path of the capture handler for `capture`, the publish completer for `publish`) while the job is `exhausting`; `onAbandoned` is called once if that hook failed five times. There is no `testing.queue`: `testing` requires a `runner` and the database queue is the only queue.

**Forked capture** (`testing.workerEntry`, `core/src/capture/forked/`, opt-in, no new investment). The parent is the consumer: `createForkedCaptureHandler` is its `capture` handler, which pushes each leased job to a child over IPC (`{ type: "run", runId, job }`, and `cancel`) and waits for `progress`, `done` or `failed`. Progress renews the lease the consumer keeps; there are no `poll`, `enqueue`, `ack` or `nack` messages, and the concurrency slots live in the parent. The child (`runCaptureChild`) runs `createCaptureHandler` over the same database, storage and runner, and inserts shard jobs into the database queue itself. A child crash fails the run of the job it took down (charged against `testing.retries` like any attempt; runs that shared the crashed child are pushed again uncharged, one at a time); a child that makes no progress for a lease is killed; three crashes in five minutes, or a failed fork, hand everything to the in-process handler.

Enqueue wakes this instance's waiting poll at once; other instances find the job on their next
poll (`startPollLoop`: no poll while all slots are busy, 15 s idle, 2 s after recent work, with
jitter). Tests: the pollable cases of `queueContractSuite` and `databaseQueueMultiInstanceSuite`
(`@storyshelf/core/test-helpers`) on the fake database, node:sqlite, PGlite and two OS processes on
one SQLite file, plus gated live runs on Postgres, MySQL and Turso.

> **Note on Architecture:** The `CaptureQueue` interface is fully asynchronous — `enqueue`, `status`, `active` and `recent` all return `Promise<T>` — so the same contract backs the database queue and the queue of a forked child. There is no `testing.queue` option: `testing` needs a `runner` and the database queue is the only queue.
