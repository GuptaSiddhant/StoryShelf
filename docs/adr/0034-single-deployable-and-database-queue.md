# ADR 0034: One Deployable: `uiTesting`, a Database Queue, and No Separate Worker

## Status

Proposed. Amends ADR 0031 (phases 2, 3 and 5) and, in part, ADRs 0003, 0015, 0018 and 0022; see
Amendments. ADR 0033 (remote browsers) is its companion and assumes it.

## Context

Running StoryShelf's checks takes more pieces than it should, and they overlap.

1. **The option is named for one stage.** `ShelfOptions.capture` holds the runner, the queue and the
   capture tuning, while `compare` is a separate top-level option kept so the re-diff endpoint works
   "even when nothing renders here". The feature as a whole is more than capture: visual diffs,
   `play`-function (interaction) tests, accessibility checks, and the review that follows. Only
   rendering is gated on `capture`; compare, review and baselines are reachable whether or not
   anything can render.
2. **A second deployable that is the app again.** `@storyshelf/worker` polls a queue and runs the
   whole pipeline, so it needs the database, storage, the secret and the runner configured a second
   time. The ADR 0031 review found bugs that came from that duplication: the forked child ignoring
   `compare.threads`, and a server validating settings against a runner the workers might not match.
   It also puts database and storage credentials in the process that runs customers' Storybook
   JavaScript in a local browser.
3. **Five ways to queue.** An in-process queue, a forked parent/child IPC queue, and four adapter
   packages (SQS, Redis, Azure, GCP; about 2,100 lines of source and 3,200 of tests, every one
   carrying the `shard` field). Each has its own lease and retry behaviour.
4. **The in-process path assumes one instance.** On boot the app requeues every build left in
   `capturing`; a second instance starting would reset builds legitimately running on the first. So
   horizontal scaling is unsafe unless a remote queue and an external worker are used.
5. **Scale-out is wanted on the browser side.** ADR 0033 makes the browser farm the thing operators
   scale. Nothing else needs to touch the database.

## Decision

### 1. `uiTesting` is the umbrella option, and absent means hosting only

`uiTesting` replaces `capture`. It covers capture (rendering), compare, review, baselines and commit
statuses, because they are stages of one feature. `visualTesting` was rejected as too narrow (it
also runs `play` tests and accessibility checks), and `test` or `testing` collide with Storybook's
own test terminology (`subtype: 'test'`, the Vitest addon, this repository's `nub run test`).
Chromatic's "UI Tests" groups the same three kinds of check, which is the closest precedent.

```ts
createShelfApp({
  database,
  storage,
  uiTesting: {
    runner: createPlaywrightCaptureRunner({ browsers: ["chromium", "firefox"] }),
    compare: { threads: 2 }, // moves here from the top level
    concurrency: 2,
    shardSize: 400,
  },
});

createShelfApp({ database, storage }); // hosting only: uiTesting is off
```

- **Absent:** Storybook hosting only. Uploads, published Storybooks, projects, tokens and members
  keep working. Capture, compare (including re-diff), review pages and APIs, baselines (import,
  export, approval), commit statuses (they are posted by the capture job), the capture settings, the
  compute-jobs page and the features that read snapshots (AI triage) are off.
- **`compare` moves under `uiTesting`.** ADR 0031 phase 2 kept it top-level so re-diff works with
  nothing rendering locally; with no separate worker, an instance that needs compare is an instance
  with `uiTesting`.
- **Mechanism:** one flag on the store, one guard per route group, the navigation and MCP tools
  filtered by the same flag. A disabled endpoint returns 404 with a body saying that uiTesting is not
  enabled on this instance, and the OpenAPI document marks which endpoints need it. The exact list of
  route groups is settled by an audit during implementation.
- **Existing data is hidden, not deleted.** Turning `uiTesting` off on a deployment that has
  snapshots hides them; startup logs it and the System page shows a notice with the count.
- **Pending builds are never silent.** When `uiTesting` is off and builds are pending, the System page
  says so, and the CLI's upload output says the Storybook was published but no checks will run.

### 2. `uiTesting` requires a long-running server

Enabling `uiTesting` requires a long-running server: a container, VM, Fly Machine, Kubernetes pod or
similar. Capture jobs run for minutes in the background, and the job consumer (decision 3) has to
keep running between requests. Platforms that freeze or end the process after each request (Vercel
Functions, AWS Lambda, Cloudflare Workers) cannot host it; they can still host Storybook hosting
only. The app warns at startup when `uiTesting` is set and a known serverless environment variable
is present (for example `VERCEL`, `AWS_LAMBDA_FUNCTION_NAME`). Consequently the Cloudflare D1
preset, a Workers-only binding, cannot back a deployment with `uiTesting`; Turso over the network
can.

Every instance with `uiTesting` both enqueues and consumes. An "API only" instance (a `render: false`
flag) was considered for a serverless API in front of a long-lived capture tier, and for scaling web
and capture separately; neither is needed, because rendering scales in the browser farm (ADR 0033).
It can be added later if a real case appears.

### 3. No separate worker

`@storyshelf/worker` is retired. Its consumer loop moves into core and runs in every app instance
with `uiTesting`: poll, a lease renewed on progress and not on a timer (so a hung capture loses it),
retry with backoff, the final-attempt rule, cancelling the local run when the lease is lost, and a
drain on SIGTERM. Operators provide database and storage credentials only to the app, and there is
one copy of the configuration.

### 4. One queue: the database

The database becomes the only queue. A `capture_jobs` table (DDL for SQLite, Postgres and MySQL, plus
migrations) holds one row per job, including shard jobs:

- **Claim without compare-and-swap.** A claim is a unique-key insert of `<jobId>:<attempt>`, the same
  trick as the finalize claim (ADR 0031 phase 5); `DatabaseAdapter.transact` is optional, so nothing
  relies on it. When a lease expires, any instance may claim the next attempt number.
- **Leases follow progress.** Instances touch the lease as the job makes progress, throttled, never on
  a timer.
- **Enqueue** inserts the row and wakes the local consumer directly, so a single instance dispatches as
  fast as the in-memory queue does; other instances find the job on their next poll, which backs off
  when idle and carries jitter. An index on status and visibility time keeps an empty poll cheap.
- **Retry and failure.** A nack with a delay sets the visibility time; attempts are counted; past the
  limit the job is `failed` and the build takes the standard terminal path, with its status written
  to the database, so a job failed by a crash never leaves a build in `capturing`.
- **Cancel** sets a flag the running instance sees on its next lease renewal and turns into
  `runner.cancel`, which replaces the in-process direct call and works across instances.
- **Views.** `status`, `active` and `recent` read the table, so the compute-jobs page shows every
  instance's jobs, not only the connected one's.
- **Trace propagation** (ADR 0022 section 9) is unchanged: `traceparent` and the request id travel in
  the job row.
- **Retention.** Finished job rows are purged with the rest of retention.
- **Backends.** Any `DatabaseAdapter`. Postgres, MySQL and Turso (libSQL over the network) support
  any number of instances on any hosts. Local-file SQLite (`node:sqlite`, `better-sqlite3`,
  `bun-sqlite`) supports several processes on one host. D1 is excluded by decision 2.

The in-memory queue is removed from production, along with the boot sweep that requeues builds left
in `capturing` (requeue once, then fail): lease expiry and redelivery do that job, and they are safe
with more than one instance. A small in-memory double may remain in the test helpers.

### 5. Forked capture keeps working

Forked capture (ADR 0031 phase 3) stays for operators who run local engines on one machine. Its
parent becomes the consumer of the database queue and pushes each leased job to the child over the
existing IPC; the child's progress messages renew the lease, which the parent writes; the child never
reads the queue. The protocol shrinks (no `poll`, no `enqueue`) and `IpcCaptureQueue`, the job book
and the lease book simplify. Whether to retire forked capture once remote browsers are common is a
later decision.

### 6. The queue adapters are retired; the interfaces stay

`@storyshelf/queue-sqs`, `queue-redis`, `queue-azure` and `queue-gcp` are retired through the
`docs/deprecated.md` process (a row per package in the PR that deletes it, then `npm deprecate` per
published version). This happens only after the database queue passes the queue contract suite and a
multi-instance test on Postgres, MySQL and Turso, and a same-host test on local SQLite. The
`CaptureQueue` and `PollableCaptureQueue` interfaces and the contract suite stay exported, so anyone
can supply a queue.

Reasons to keep an external queue were considered:

- **Hosted, multi-tenant scale** is the one strong case: a managed queue beats database polling at
  that job rate. It is not the self-hosted product's case today. Revisit if a hosted offering needs
  it.
- **Autoscaling on queue depth** (KEDA, HPA) is covered by exporting queue depth and oldest-job age as
  metrics through `@storyshelf/observability`.
- **Operator policy** (dead-letter queues, queue-age alarms) is mostly covered by a `failed` state, an
  admin view and the same metrics.

### 7. The browser farm is the scale-out unit

Per ADR 0033, rendering scales by adding sessions in a browser farm. A self-hosted farm needs no
StoryShelf package: it is the official Playwright image running `playwright run-server`, pinned to
the same version as our `playwright-core`, or Browserless (open source under SSPL-1.0 or a paid
commercial licence, which matters to operators who run closed-source CI), with a token and a
concurrency cap in front. We maintain:

- a documentation guide with a Compose and a Kubernetes snippet;
- a test that fails when the version pinned in that guide drifts from the dependency;
- a clear error at connect time when client and server versions differ, naming both and the image tag
  to use.

Unverified: whether a bare `run-server` has built-in authentication or a concurrency cap; the spike in
ADR 0033's implementation order settles it. The farm's network position matters: a story that calls
an internal service from the browser needs a farm inside that network.

## Amendments to existing ADRs

- **0031 phase 2:** the nested `capture` group is `uiTesting`, and `compare` nests under it instead of
  staying top-level.
- **0031 phase 3:** the in-memory fallback queue goes; the forked parent consumes the database queue
  and pushes jobs to the child (decision 5).
- **0031 phase 5:** shard jobs ride the database queue. The `shard` field leaves four transports, and
  the note that remote queues need no change beyond carrying it is obsolete.
- **0003:** "an in-process queue with configurable concurrency (`--capture-concurrency`)" is replaced
  by the database queue with the same concurrency setting.
- **0015:** "`createShelfApp` builds the orchestrator internally when `capture` is supplied" becomes
  `uiTesting`; the `runner-remote` idea of offloading to a worker fleet is realised by remote browsers
  (ADR 0033), not by a worker.
- **0018:** "queue/remote workers depend on core alone: zero HTTP modules in worker bundles" is
  obsolete with no worker package, since the app is the consumer.
- **0022 section 9:** trace propagation across the queue boundary still holds; `traceparent` travels
  in the job row instead of a message body, and the four adapters' parsers go.
- **0002:** no contradiction. Turso remains the way to host Storybooks on serverless platforms; D1
  stays hosting-only (decision 2).

Each amended ADR gets a one-line pointer to this one in the same PR as this ADR.

## Documentation changes

The website describes behaviour that still exists, so it changes with the implementation PRs, not
with this ADR. The pages to change, and the statement they must carry:

> Enabling `uiTesting` requires a long-running server (a container, VM, Fly Machine or Kubernetes
> pod). It cannot run on serverless platforms that freeze or end the process after each request
> (Vercel Functions, AWS Lambda, Cloudflare Workers), because capture jobs run for minutes in the
> background and the job consumer must keep running. A serverless deployment can host Storybooks
> only, by leaving `uiTesting` unset.

- `concepts/capture.mdx`: the remote capture, queue and forked capture sections, and the statement.
- `guides/deployment/cloud` (cloud assembly): the serverless API with a separate worker goes; the
  guide becomes hosting-only on serverless and `uiTesting` on a long-running server.
- `packages/worker.mdx` and the four `packages/queue-*.mdx` pages, and those packages' READMEs, with
  deprecation notes.
- The configuration reference (`capture` becomes `uiTesting`, `compare` nests) and the runner pages
  (the `browsers` list, ADR 0033).
- A migration guide: `capture` to `uiTesting`; a worker deployment to more app instances; queue
  adapters to the database queue; serverless to hosting-only.
- A "self-hosted browser farm" guide (decision 7).
- `docs/architecture.md`, and `AGENTS.md` (layout and ADR index).

## Consequences

**Positive**

- One deployable and one copy of the configuration; database and storage credentials live only in the
  app, and customers' Storybook JavaScript runs only in browsers that hold none.
- Horizontal scaling is safe: jobs are persistent, leased and redelivered, and boot recovery no longer
  assumes a single instance.
- One queue with one set of semantics, instead of five, and the live queue view is cross-instance.
- Six packages fewer (`worker` and four adapters, plus the IPC queue's bookkeeping), and a simpler
  `capture-setup`.
- Hosting-only is a clean, documented mode, and `uiTesting` is the single switch for the product.

**Negative**

- A broad breaking change: the option rename and `compare` move, the worker and four adapters
  retired, and serverless plus capture no longer supported. Operators using SQS or Redis queues must
  move to the database queue.
- New queue code, with the race risks any lease implementation has. It needs the contract suite and
  multi-instance tests before anyone relies on it.
- Database polling and lease writes grow with instance count. Unmeasured, and for Turso also a billing
  question.
- Web requests and capture work share an instance's CPU (diffing uses most cores). Operators limit
  `concurrency` and `compare.threads`, or add instances.
- Route gating is new work spread across many routers, and the API surface now depends on
  configuration.

## Alternatives considered

- **Keep the worker as a separate role (`render: false`).** Rejected for now: no use case once
  rendering scales in the farm. Cheap to add if one appears.
- **Keep the queue adapters as first-party options.** Rejected: four packages of maintenance for a case
  the database covers; the interfaces stay for anyone who needs one.
- **Keep the in-memory queue for single instances.** Rejected: a second code path with different
  semantics, to save a few row writes next to hundreds of snapshot rows per capture.
- **A render service** (`CaptureRunner.render` over HTTP, so the pool keeps page pooling). Rejected for
  now (ADR 0033): providers such as Azure and BrowserStack cannot use it, so it would be a second
  mechanism.
- **Other names:** `visualTesting` (too narrow), `checks` (generic), `testing` and `test` (collide with
  Storybook's own testing), `quality` (vague).

## Open questions

- The exact list of route groups to gate, found by an audit before implementation.
- Polling load with many instances, and Turso's read billing: measure with the multi-instance test.
- How cancel latency relates to the lease-renewal interval.
- Where the retry limit (`maxRetries`, today a worker setting) lives in `uiTesting`.
- Whether the serverless warning should refuse to start instead of warning.
- Whether forked capture survives once remote browsers are common (decision 5).

## Implementation order

1. **The database queue and the consumer loop in core**, behind the existing interfaces, validated by
   the contract suite and the multi-instance tests (Postgres, MySQL, Turso, local SQLite). Additive:
   nothing is removed yet.
2. **`uiTesting`**: the rename, the `compare` move, the gating, the notices and the serverless
   warning. This is the breaking step.
3. **Remove the in-memory queue and the boot recovery sweep;** forked capture's parent becomes the
   consumer.
4. **Retire `@storyshelf/worker` and the four queue adapters** (deprecation rows, `npm deprecate`).
5. **Documentation** with each of the above, ending with the migration guide. The farm recipe and the
   version-pin test ship with ADR 0033's step 2.
