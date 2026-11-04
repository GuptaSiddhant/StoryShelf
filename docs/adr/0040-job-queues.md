# ADR 0040: Job Queues and Adding Queued Work

## Status

Accepted for decisions 1, 2 and 4, which record current behavior, and for the investigation
placement in decision 3, which comes from the #343 resolution. The general rule in decision 3
(separate consumers rather than a priority column) is **proposed** and awaits owner confirmation.
This ADR amends ADR 0006 decisions 4, 5 and 11; their claim, lease, fencing, cancel and polling
mechanics stay as written there.

## Context

ADR 0006 made the database the only queue. Since then the app has grown a second consumer for
`notify` jobs with its own retry limit, while agent guidance still says "one consumer" and
"`testing.retries` is the only retry limit". More kinds are coming: investigations (#379) must never
delay capture, exhausted-job recovery (#259) and hung-phase bounds (#287) touch every kind, and
deployment-wide capacity (#364) is open. Without a recorded rule each new kind would pick its own
semantics.

## Decision

### 1. One table, several consumers

- Every job of every kind is a row in `capture_jobs` (ADR 0006 decision 4). There is no in-memory
  production queue and no external queue adapter.
- A **queue** in the app is a consumer over a set of kinds with its own retry limit, built by
  `createJobQueue(options, kinds, maxRetries)` in `packages/app/src/jobs-setup.ts`. Today:

| Queue  | Kinds                                                                   | Retry limit                                                                     | Where                           |
| ------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------- |
| Main   | `capture` (when `testing.runner` is set), `publish` (long-running host) | `testing.retries` (default 2, three attempts)                                   | `queuesFor`, `databaseConsumer` |
| Notify | `notify` (long-running host)                                            | `NOTIFY_MAX_ATTEMPTS` (5) minus one; handler retry delay 10 s doubling to 5 min | `queuesFor`, `notifyConsumer`   |

- A host with no consumer (serverless) runs neither queue: build state is delivered inline without
  durability (`packages/app/src/build-state-setup.ts`), and publishing follows ADR 0006 decision 10.
- `notify` has its own consumer so that a git status never waits behind captures that hold every
  slot for minutes. Queue views list every polled kind except `notify`.
- **Cancel spans kinds.** Because all kinds share the table, `cancel(buildId)` on the database queue
  cancels capture, publish and notify jobs of the build (`packages/app/src/job-canceller.ts`).
- Forked capture is unchanged: the parent consumes; the child never reads the queue.

### 2. What every job kind must provide

- A handler registered on exactly one consumer. A job without a handler fails clearly.
- Work that is idempotent per attempt (ADR 0006: each attempt is its own fenced row).
- An `exhausted` hook (`JobQueue.exhausted[kind]`) when losing the final lease must change domain
  state, as capture (fail the build) and publish (complete as failed) do today. The queue runs it
  in a leased `exhausting` phase: a failed or lost run is re-run by any instance after its lease,
  up to five runs, then the job fails and `JobQueue.abandoned[kind]` alerts once (#432).
- Lease renewal through `keepJobLease` for any phase that can run longer than a third of the lease.
- Cancellation by build id, honored within the cancel latency of ADR 0006 decision 11.
- A wall-clock bound: `testing.maxJobSeconds` (default 7200) applies to every kind. Past it
  `keepJobLease` stops renewing, the `AbortSignal` in the handler's context fires, the run is
  cancelled and the consumer's slot is freed; the job is not settled, so its lease runs out and the
  normal exhausted or redelivery path takes over. A capture ends its build `failed`, never
  `cancelled`, and its attempt log records `job deadline exceeded (<n>s)`. Publish stops at its next
  progress report (after extraction and after persisting); storage adapters keep their SDK
  timeouts. A phase that never reports is bounded only by the lease: work already running is
  not interrupted. There is no per-phase knob.
- Its retry limit stated where the queue is built, not inferred from `testing.retries`.
- Kinds that must be single-flight per key use `active_key` (a unique column, cleared in the write
  that ends the job), never a check before the insert.

### 3. Precedence comes from separation and admission, not priorities (proposed rule)

- A kind joins the main queue only if it may wait behind capture and shares capture's retry limit.
- A kind that must not delay, or be delayed by, capture gets **its own consumer** over the same
  table, with an explicit retry limit and slot count, following the `notify` precedent.
- There is no priority column and no preemption. Dispatch order within a consumer stays
  oldest-visible-first.
- **Investigations (accepted, #343):** a distinct `investigation` kind with a dedicated consumer
  filter, so ordinary capture workers never claim it. Admission is database-atomic: at most one
  running investigation per deployment, admitted only when capture and publish work is not ready or
  not using its configured capacity. Priority is non-preemptive: a newly arriving capture does not
  stop a running investigation. Investigation browser sessions count against the same provider
  limits as capture. A job is bounded to five minutes with at most one retry of a transient
  infrastructure failure. With no compatible consumer, the request reports unavailable rather than
  queueing indefinitely. Pin handling is in ADR 0039.

### 4. Retry limits are per queue

`testing.retries` is the retry limit of the main queue. Other queues declare their own constant
next to their handler (`NOTIFY_MAX_ATTEMPTS` in `packages/core/src/capture/build-state/notify-job.ts`).
A lost lease, a failed attempt and a child crash count against the same limit within a queue.

## Not decided here

- Deployment-wide capacity and backpressure across instances (#364).
- Any generic runtime priority scheduler. The ordered work list in issue #370 is a planning tool,
  not runtime behavior.

## Consequences

**Positive**

- A status update or an investigation cannot starve, or be starved by, capture.
- Cancel and retention stay uniform because every kind shares one table.
- New kinds have a checklist instead of an open design question.

**Negative**

- Each extra consumer adds polling; idle cost grows with the number of consumers per instance.
- Separate retry limits per queue are more to document and test than one global limit.
- Non-preemptive admission means a capture can wait for a running investigation to finish its
  bounded five minutes.

## Alternatives rejected

| Option                             | Why not                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Priority column on `capture_jobs`  | Needs fair-share and starvation rules across instances; separation already gives the isolation needed. |
| Preempt investigations for capture | Kills work mid-replay and complicates pin release (ADR 0039).                                          |
| One consumer for every kind        | A capture holding every slot delays git statuses; this is why `notify` has its own consumer.           |
| External queue per kind            | Rejected in ADR 0006 decision 6; nothing here changes that.                                            |
