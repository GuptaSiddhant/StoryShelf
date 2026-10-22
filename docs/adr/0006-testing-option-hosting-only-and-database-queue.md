# ADR 0006: Testing Option, Hosting-Only Mode and the Database Queue

## Status

Accepted. Amended with the `capture_jobs` table, the claim algorithm and the poll and cancel
details (decisions 4 and 11), recorded while implementing the database queue (#212), and with the
cutover details (decisions 4 and 5), recorded while moving the app onto it (#217), and with the
`notify` job kind (decision 4), recorded while implementing it (#222).

Supersedes (archived): ADR 0034.

## Context

StoryShelf does two jobs: it hosts published Storybooks, and it runs checks on them (visual diffs,
`play`-function interaction tests, accessibility checks) whose results people review. The checks
need a renderer, an image engine, a job queue and long-running background work; hosting needs none
of these. This ADR fixes how one deployable offers both, how it runs with checks switched off, and
how background work is queued.

The forces behind it:

- **One option for one feature.** Capture, compare, baselines and the testing commit status are
  stages of a single feature, so they are configured together, and an instance that compares or
  serves diffs is one that can render.
- **No second deployable.** A separate worker that runs the pipeline needs the database, storage,
  the secret and the runner configured a second time; duplicated configuration produces drift bugs
  (a child ignoring `compare.threads`, settings validated against a runner the workers do not match)
  and puts database and storage credentials next to customers' Storybook JavaScript.
- **One queue, safe with many instances.** Several queue transports each carry their own lease and
  retry behaviour, and a boot sweep that requeues in-flight builds is unsafe once a second instance
  starts.
- **Scale-out happens in the browser farm** (ADR 0007, Remote Browsers and Public Origin). Nothing
  else needs to touch the database.
- **Hosting-only is a real use**, including on serverless platforms, and has to publish, catalogue
  and show Storybooks without any capture pipeline.

## Decision

### 1. `testing` is the umbrella option; absent means hosting only

`ShelfOptions.testing` covers capture (rendering), compare, baselines and the testing commit status.

```ts
createShelfApp({
  database,
  storage,
  testing: {
    runner: createPlaywrightCaptureRunner({ browsers: ["chromium", "firefox"] }),
    compare: { threads: 2 },
    concurrency: 2,
    shardSize: 400,
  },
});

createShelfApp({ database, storage }); // hosting only: testing is off
```

```ts
interface TestingOptions {
  runner: CaptureRunner; // required: every testing instance can render
  compare?: { threads?: number };
  images?: ShelfImagesOptions; // image engine (ADR 0008)
  concurrency?: number; // jobs this instance runs at once
  shardSize?: number; // ADR 0005
  retries?: number; // default 2 (decision 11)
  storybookUrlRateLimit?: number; // requests a minute per IP on the signed Storybook URL route (ADR 0007); default 6000
  queue?: PollableCaptureQueue; // replaces the database queue (decision 6)
  workerEntry?: string; // forked capture (decision 5)
  mode?: "auto" | "in-process" | "fork";
}
```

- **`compare` and `images` live under `testing`.** The image engine serves diffs, overlays and
  snapshot thumbnails, none of which exist without capture (AI thumbnails read snapshots too), and
  with no separate worker an instance that needs compare or an image engine is an instance with
  `testing`. Every `testing` instance has a runner; there is no enqueue-only configuration.
- **`scratchDir` stays in `config`**, optional, defaulting to the OS temp directory, because it
  serves publishing as well as capture.
- **Absent `testing`: Storybook hosting only.** Uploads, published Storybooks and their publishing
  (decision 10), projects, tokens, members, labels, webhooks, and the build, library and component
  pages (decision 9) work. Capture, compare (including re-diff), snapshot-level review, baselines
  (import, export, approval), the `<prefix>/testing` status, the capture settings, the compute-jobs
  page and features that read snapshots (AI triage) are off. A repository that requires the testing
  status must drop that requirement before `testing` is turned off. The `<prefix>/storybook` status
  is posted on every build and, with review on, the `<prefix>/review` status (ADR 0014, Git Hosts and
  Notifications).
- **Hosting-only is not open access.** The auth rules (ADR 0011, Authentication and Access) apply
  unchanged: who may view a published Storybook or the library, component and build pages, and who
  may upload, comment or approve, is decided by the auth adapter and the project's access settings,
  with or without `testing`. Route classes (decision 8) gate features, never access; a `hosting`
  route is not a public route.
- **Mechanism.** One flag on the store, a `requireTesting` guard applied per route, and the same
  classification driving the navigation, the MCP tool list and the OpenAPI "requires testing"
  marker. A disabled endpoint returns 404 with a body saying testing is not enabled on this instance.
- **Existing data is hidden, not deleted.** Turning `testing` off on a deployment that has
  snapshots hides them; startup logs it and the System page shows a notice with the count.
- **Visibility of the mode.** The System page states that `testing` is off, so a misconfigured
  instance in a fleet is visible, and the CLI's upload output says the Storybook was published but
  no checks will run.

### 2. Review is a project setting, and the auto-accept rule

Review (comments and sign-off) is independent of `testing`. It is a per-project boolean
(`projects.review_enabled`, default on) edited by project admins; there is no instance option. Its
design is ADR 0013 (UI Review). This ADR fixes the rule for when a build is accepted without anyone
reviewing it:

- **Default branch: always accepted.** With `testing` off the build becomes `approved` when it
  finishes publishing. With `testing` on it becomes `approved` when capture finishes, its changes
  auto-approved (`diffStatus`, `finalBuildStatus`), unless capture failed. The default branch is
  never held, so the project's Storybook link always resolves.
- **Other branches with `testing` off:** accepted when publishing finishes only if the project has
  turned review off. With review on, the build waits as `pending` for a build-level verdict.
- **Other branches with `testing` on:** the snapshot rollup decides, as for any captured build.

An automatically accepted build fires no approval event; the `build:created` webhook already
announces the upload. A build whose publishing fails becomes `failed`.

### 3. `testing` requires a long-running server

Capture jobs run for minutes in the background and the job consumer (decision 4) keeps running
between requests, so `testing` needs a container, VM, Fly Machine, Kubernetes pod or similar.
Platforms that freeze or end the process after each request (Vercel Functions, AWS Lambda,
Cloudflare Workers) can host Storybooks only. The Cloudflare D1 preset, a Workers-only binding,
therefore cannot back a deployment with `testing`; Turso over the network can.

Hosting only on a serverless platform publishes through the file-by-file upload route (`/dedup`,
`/content`, `/manifest`), which stores content-addressed files and needs no extraction or scratch
disk (ADR 0003, Storage and Content-Addressed Assets). A zip that cannot be extracted inline on such
a host is rejected at upload with that explanation rather than left pending (decision 10).

Every instance with `testing` both enqueues and consumes. There is no API-only role
(`render: false`); rendering scales in the browser farm. It can be added if a real case appears.

### 4. The database is the queue

A `capture_jobs` table (DDL for SQLite, Postgres and MySQL) holds one row per job. Job kinds are
`capture` (including shard jobs), `publish` (decision 10) and `notify` (durable git-host state
delivery, ADR 0014). `Tables` gains `captureJobs` (and `buildComponents`, decision 9); this breaks
third-party `DatabaseAdapter` implementations, which is accepted.

- **Job rows and shard rows.** A shard job is a `capture_jobs` row referencing its `capture_shards`
  row (ADR 0005, Capture Performance and Sharding). The job row holds delivery state (queued,
  running, done, failed); the shard row holds the capture result and its kind (plan, render,
  finalize).
- **Claim and fencing without compare-and-swap.** `DatabaseAdapter.update` is unconditional and
  `transact` is optional, so each attempt has its own row, `<jobId>:<attempt>`, created by a
  unique-key insert (as the finalize claim is), holding the owner, the lease expiry and, at the end,
  the result. A holder writes only its own attempt's row, so a stale holder cannot overwrite a newer
  owner's lease. When a lease expires, any instance inserts the next attempt's row. A job is done
  once any attempt row is `done`; a later attempt notices at its next progress touch and stops. Work
  is idempotent per attempt, so a stale holder finishing late costs a duplicate run, not a wrong
  result.
- **One table, two kinds of row** (`Tables` gains only `captureJobs`). The poll must find both a
  queued job and an expired lease with one indexed query, so job rows and attempt rows share the
  table and the indexed visibility column, told apart by `entry`:

  | Column                                                           | Job row (`entry = 'job'`)                                                            | Attempt row (`entry = 'attempt'`)                 |
  | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------- |
  | `id`                                                             | job id (ULID)                                                                        | `<jobId>:<attempt>` (the fence)                   |
  | `job_id`                                                         | its own id                                                                           | the job it belongs to                             |
  | `kind`                                                           | `capture`, `publish` or `notify`                                                     | copied from the job                               |
  | `build_id`, `shard_id`                                           | the build (none for some notify jobs); the `capture_shards` row of a shard job       | copied                                            |
  | `attempt`, `max_attempts`                                        | attempts started; `testing.retries` + 1                                              | its number, from 1                                |
  | `status`                                                         | `queued`, `running`, `done`, `failed`, `cancelled`                                   | `running`, `done`, `failed`, `expired`            |
  | `visible_at`                                                     | while `queued`: when it may be claimed (new, or retry after backoff); otherwise null | while `running`: the lease expiry; otherwise null |
  | `owner`                                                          | null                                                                                 | the instance holding it                           |
  | `payload`                                                        | JSON: request id, `traceparent`, kind-specific data                                  | null                                              |
  | `cancel_requested_at`                                            | set by cancel, never cleared                                                         | copied at claim, or set by cancel                 |
  | `error`, `started_at`, `finished_at`, `created_at`, `updated_at` | last attempt's error; timestamps                                                     | its own                                           |

  There are no foreign keys (notify jobs may have no build); finished rows are purged by retention.
  Indexes: `(kind, visible_at, status)` for the poll, `(job_id)`, `(build_id)` and
  `(entry, created_at)` for the views.

- **The claim, step by step.** (1) Probe for the oldest candidate of the polled kind:
  `WHERE kind = ? AND visible_at <= now AND status IN ('queued', 'running')`, in `visible_at`
  order, `LIMIT 1`. (2) For a job row, the next attempt is `attempt + 1`; for
  an expired attempt row, the one after the higher of its number and the job row's. Past
  `max_attempts` the job is `failed` (a lost lease counts as an attempt; a late `done` on that
  attempt wins). (3) Insert the attempt row: exactly one instance wins on every database; the losers
  see the key conflict, told apart from other errors by re-reading the row. (4) The winner re-reads
  the job row and gives the claim back (marking its attempt `expired`) if the job ended or was
  cancelled meanwhile; otherwise it marks the attempt it replaced `expired` and the job row
  `running` (`visible_at` null). (5) A loser whose winner has not marked the job yet checks the
  winner's lease: once expired (the winner died between steps 3 and 4) it claims the next attempt as
  for any expired lease; until then it moves the job row's `visible_at` to that lease so the job
  does not hold the head of the queue. It writes only `visible_at`, never the status, so a winner
  that already finished keeps its outcome; a job row left `running` with a `visible_at` is cleared
  when probed.
- **Holding, finishing and retrying.** Renewal updates only the holder's attempt row and returns it:
  `expired` means lost, a cancel flag means cancelled; then the job row is read, so a job finished by
  another attempt (lost) or cancelled is seen at that progress touch. A nack from a holder whose
  attempt is no longer `running` or no longer the job's current attempt writes nothing to the job,
  so a stale holder cannot requeue or fail a job another instance runs. Otherwise a nack requeues the
  job row (`queued`, `visible_at` = now + delay), or fails it past `max_attempts` or with
  `requeue: false`, or ends it `cancelled` when flagged. An ack marks the attempt and the job `done`
  (a cancelled job stays cancelled).
- **Why one indexed query suffices.** `visible_at` is non-null only on rows that are or will be
  claimable, every write that ends a row's candidacy nulls it, and a late renewal of a retired
  attempt is nulled again by the renewer. So the probe is one range scan of the index in
  `visible_at` order that stops at the first row: an idle queue reads no rows, a busy one reads one.
  A queue that polls several kinds at once (`publish` and `notify` on a hosting-only instance) scans
  the visible rows of those kinds and sorts them; idle, that is still no rows.
- **`notify` jobs** (ADR 0014, decision 7) differ from the other kinds in three ways. A job states
  its own `maxAttempts` at enqueue (five, instead of `testing.retries` + 1) and its handler its own
  retry delay (10 s doubling to five minutes, instead of 1 s to 30 s). They run on a second queue
  instance polled by a consumer of their own, so a capture holding every slot cannot starve a
  status; the instance that enqueues wakes that consumer at once. The queue views (`status`,
  `active`, `recent`, `cancel` by build) list every polled kind but `notify`.
- **Leases follow progress**, throttled, never on a timer, so a hung capture loses its lease.
- **Enqueue** inserts the row and wakes the local consumer directly, so a single instance dispatches
  immediately; other instances find the job on their next poll. An index on status and visibility
  time keeps an empty poll cheap.
- **Retry and failure.** A nack with a delay sets the visibility time; attempts are counted; past
  `testing.retries` the job is `failed` and the build takes the standard terminal path with its
  status written to the database, so a crash never leaves a build in `capturing`. A job whose
  final attempt loses its lease has no running handler to write that path, so the queue calls the
  host's `onExhausted(job, error)` hook (any instance that finds the job may call it, so it is
  idempotent): the app fails the build of a `capture` job (`failCrashedCapture`, then the admin
  alert) and completes a `publish` job as failed.
- **Cancel** sets a flag on the job row, which the running instance reads (decision 11) and turns
  into `runner.cancel`. It works across instances and for a hung capture. Cancelling a job that has
  not started is immediate. `CaptureQueue.cancel(jobId | buildId)` is the queue-level setter (a
  build id cancels the build's unfinished jobs of the queue's kinds); it also flags the running
  attempt row, and `LeaseRenewal` gains `"cancelled"`, which `extend` and the new non-renewing
  `PollableCaptureQueue.inspect` report. The API and UI that call it come with the cutover.
- **Views.** `status`, `active` and `recent` read the table, so the compute-jobs page shows every
  instance's jobs.
- **Trace propagation** (ADR 0015, Observability and Logging): `traceparent` and the request id travel
  in the job row.
- **Retention.** Finished job rows are purged with the rest of retention.
- **Backends.** Any `DatabaseAdapter` that supports a unique-key insert whose conflict can be told
  apart. Postgres (`postgres.js`, `pg`, Neon, Vercel, and `neon-http`, since nothing needs
  interactive transactions), MySQL and Turso support any number of instances on any hosts.
  Local-file SQLite (`node:sqlite`, `better-sqlite3`, `bun-sqlite`) and embedded `pglite` support the
  processes of one host. D1 is excluded (decision 3).

There is no in-memory production queue and no boot sweep that requeues builds left in `capturing`;
lease expiry and redelivery recover work and are safe with many instances. A small in-memory double
may remain in test helpers.

**Upgrade.** No migration sweep ships: a build left `capturing` or `pending` by an earlier version
with no job row stays as it is, and is retried by hand. Mixed versions are not supported; every
instance is stopped, upgraded and started together.

### 5. No separate worker; the consumer runs in the app

There is no `@storyshelf/worker` package. The consumer loop lives in `@storyshelf/core/capture` and
runs in every app instance with `testing`: poll, a progress-driven lease, retry with backoff, the
final-attempt rule, cancelling the local run when the lease is lost, and a drain on SIGTERM.
A slot is taken before polling; a failing job waits `1000 ms * 2^attempts` (at most 30 s) before it
is claimed again, and `attempt >= maxAttempts` marks the last attempt, which is nacked without
requeue so the job ends `failed`. A job of a kind without a handler is failed with a clear error.
The constants are in one file, `consumer/retry.ts`.
Database and storage credentials are given only to the app, and there is one copy of the
configuration.

**Forked capture** stays as an opt-in for operators who run local engines on one machine. The parent
is the consumer of the database queue and pushes each leased job to the child over IPC (`run`, and
`cancel` to stop a render); the child's `progress` messages renew the lease, which the parent
writes, and `done` or `failed` settle it; the child never reads the queue (no `poll` or `enqueue`
in the protocol) and inserts the shard jobs of a big build itself. `runCaptureChild` is exported from `@storyshelf/core/capture`.
The child runs the whole pipeline, so it holds the same database, storage and runner configuration
and is inside the app's trust boundary. Forked capture receives no new investment; child restarts
and hang kills are counted, and it is retired when local engines stop being the recommended path or
the metrics show no capture-caused restarts.

### 6. No first-party queue adapters; the interfaces stay

There are no `queue-sqs`, `queue-redis`, `queue-azure` or `queue-gcp` packages; they are retired
through the `docs/deprecated.md` process once the database queue passes the queue contract suite, a
multi-instance test on Postgres, MySQL and Turso, and a same-host test on local SQLite. The
`CaptureQueue` and `PollableCaptureQueue` interfaces and the contract suite stay exported, and
`testing.queue` accepts one, so anyone can supply a queue.

The database queue asks one thing of the adapter, a unique-key insert whose conflict can be told
apart, which the finalize claim already uses. Reasons for an external queue, weighed:

- **Hosted, multi-tenant scale** is the one strong case (a managed queue beats database polling at
  that job rate). It is not the self-hosted product's case; revisit if a hosted offering needs it.
- **Autoscaling on queue depth** (KEDA, HPA) is covered by exporting queue depth and oldest-job age
  as metrics through `@storyshelf/observability`.
- **Operator policy** (dead-letter queues, queue-age alarms) is covered by the `failed` state, an
  admin view and the same metrics.

### 7. The browser farm is the scale-out unit

Rendering scales by adding sessions in a browser farm (ADR 0007). A self-hosted farm needs no
StoryShelf package: the official Playwright image running `playwright run-server`, pinned to the same
version as StoryShelf's `playwright-core`, or Browserless (SSPL-1.0 or a paid commercial licence,
which matters to operators who run closed-source CI), with a token and a concurrency cap in front.
StoryShelf maintains a guide with Compose and Kubernetes snippets, a test that fails when the version
pinned in that guide drifts from the dependency, and a clear connect-time error naming both versions
and the image tag to use when client and server differ. A story that calls an internal service from
the browser needs a farm inside that network. The farm recipe and its details are in ADR 0007.

### 8. Every route is classified, and a test keeps it that way

Routers mix kinds of route (`builds` holds uploads next to snapshot listings; `ui` holds project
pages next to the diff page), so the gate is per route. One route table in code classifies every
route into four classes; the lists below are representative, and the table is the full list.

- **`hosting`**, available with and without `testing`: projects, tokens, members, labels, auth,
  webhooks; the build upload (zip, dedup, content, manifest), listing and delete routes; Storybook
  serving.
- **`testing`**, 404 without `testing`: snapshots (list, approve, reject, approve-all, reject-all,
  rediff, per-mode), snapshot media and design renders, baselines export and import, attempts and
  their logs, status configs, insights (which also need `ai`), the capture, status and test settings
  pages, the compute-jobs page, build retry and the build diff page. Retry is `testing` because it
  sets `pending` and enqueues a capture; to capture an old build, retry it.
- **`both`**, pages present in both modes with gated sections: the build list and detail pages
  (snapshot list, statuses and attempts only with `testing`; build-level comments and verdicts in
  both), and the library and component pages (decision 9). `/projects/:slug` redirects to the
  library.
- **`review`**, 404 when the project's review switch is off, with or without `testing`: comments
  (list, create, resolve), build verdicts, the changeset, the review section of the build page and
  the project review settings. The gate is the project's setting, so it is evaluated per request.
  ADR 0013 defines these routes.

Two tests keep the table honest: one enumerates every route the app registers and fails on any that
is unclassified, so a new route must declare its class; the other boots the app without `testing`
and asserts every `testing` route answers 404 and no `hosting` route does, and asserts `review`
routes answer 404 for a project with review off. The same table drives the navigation, the MCP tool
list (ADR 0017, MCP Server) and the OpenAPI marker.

### 9. Library, component and build pages come from Storybook metadata

`index.json` is the primary data source of these pages in both modes; `testing` adds data to them
without changing where their skeleton comes from.

- **Library.** Shows the latest build of the selected branch whatever its status: the default branch
  unless another is chosen in the branch switcher, falling back to the default branch's latest build
  and then to any build. A build under review therefore appears, and a build still publishing shows
  the preparing state. Components are grouped by title, each linking to its component page and into
  the published Storybook (story and docs links), with tags and story counts, and no screenshots.
  With `testing` it gains thumbnails, statuses, the health panel and design links.
- **Component page.** The published story as an embedded preview, the component's stories and docs
  entries, the project-level design links and previews (ADR 0018, Design Providers), and a build
  history: the builds the component appears in and whether its stories changed (added, removed,
  renamed or moved) since the build before. With `testing` it gains per-story snapshot status and
  diffs, history with statuses, moved-or-deleted detection and per-story design previews.
- **Build pages.** Sha, branch, author, message, size, labels, the published Storybook link, and
  component and story counts from the catalog. Snapshots, statuses and attempts appear only with
  `testing`; build-level comments and verdicts do not depend on it. An accepted build with no
  attempts is labelled "Published", and `approvedCount` stays zero.
- **Acceptance is required, not cosmetic.** The project's Storybook link and the upstream links
  resolve only accepted builds, and retention purges terminal builds, so a hosting-only build must
  reach a status under the rule of decision 2. A `pending` build on a non-default branch keeps the
  Storybook and upstream links on the previous accepted build until it is approved; its own URLs
  answer for anyone who may view the project. Its exit when nobody reviews it is in ADR 0013 and ADR
  0009 (Baselines, Approval and Retention). Enabling `testing` later leaves accepted builds as they
  are: they have no snapshots, create no baselines, and the next default-branch build bootstraps
  baselines as usual.
- **Data.** Publishing (decision 10) writes a compact catalog for the build (entry id, title, name,
  import path, type, tags) next to its statics, and one `build_components` row per component
  (project, build, import path, title, story count, a hash of the component's entries). The catalog
  serves the library and component pages, cached in-process by build id; the table answers "which
  builds contain this component, and did it change" with one indexed query and feeds the review
  changeset (ADR 0013). Both are purged with the build. Builds published before the catalog existed
  are catalogued lazily on first view from their persisted statics.
- **Upstream links** resolve a build's stories from its snapshots when it has them and from the
  catalog otherwise, so an accepted build with no snapshots still yields links.
- **Resolved parameters are not in `index.json`.** Per-story design links and modes come only from a
  capture's `extractParameters`. Without `testing` there are no per-story design links, no modes and
  no per-story settings, and nothing treats their absence as an error. Reading parameters from the
  embedded preview was rejected (it depends on Storybook's internal channel across versions 8 to
  10), and recording them at publish would need a browser.
- **Embedding the preview is a security decision.** Path-based serving puts a customer's Storybook
  JavaScript on the app's origin (ADR 0010, Projects, Published Storybook and Labels). Embedding it on
  every page visit would run it there, so the embed uses the separate published origin
  (`publishedBaseDomain`) when configured, which the operator's proxy routes to the app, and is
  otherwise click-to-load in a sandboxed iframe with a link out.

### 10. Publishing does not depend on `testing`

Publishing completes per upload route:

- **File-by-file (`/dedup`, `/content`, `/manifest`).** Files are already stored content-addressed,
  so publishing completes when the manifest is stored, which writes the catalog from the stored
  `index.json`. With `testing` on the manifest route enqueues a capture; with it off the build is
  accepted under decision 2.
- **Zip.** A small zip is extracted inline in the request, its size counted while streaming (a
  chunked upload has no `Content-Length`). A larger zip is published by a `publish` job on the
  database queue, with the lease, retry and redelivery of decision 4, consumed by any instance on a
  long-running host with scratch space. A hosting-only instance on such a host therefore runs the
  consumer loop for `publish` (and `notify`) jobs, and `testing` adds `capture` jobs. On a host with
  no consumer, a zip over the inline limit is rejected at upload with a message pointing to the
  file-by-file route.
- **Safety.** Extraction enforces caps on entry count and on total uncompressed bytes; the compressed
  size alone is no bound.

`maxInlineUnzipSize` is the inline threshold and has a safe default. Publishing ends by writing the
catalog and, with `testing` off, applying decision 2 (`approved`, `pending` for review, or `failed`
if it could not publish), and posting the `<prefix>/storybook` status. With `testing` on, the capture
job also backfills the statics, and the capture pipeline decides the status.

**Upgrade.** With `testing` off, a one-time boot task resolves builds left `pending` from before
this design: each with a persisted zip or manifest and no attempts is accepted under decision 2, and
each with neither is failed. With `testing` on, the migration sweep of decision 4 gives them job
rows.

### 11. Operating details

- **Polling.** An instance does not poll while all its concurrency slots are busy. Otherwise it polls
  every 15 s when idle and every 2 s while jobs were recently queued, with jitter; a poll is one
  indexed query for the oldest visible job and reads at most one row. The queue's acceptance test is
  that an idle instance performs at most one such probe per 15 s and reads no rows. "Recently" means
  a job was found or queued locally in the last 60 s; jitter only lengthens a delay (up to 20 %), so
  the idle rate never exceeds one probe per 15 s. A local enqueue wakes the waiting poll at once,
  including one made while the previous probe was in flight. The probe is the query of decision 4.
- **Cancel.** Each running job reads its own row by id every 5 s, and the lease renewal write also
  returns the row, so cancel latency is at most about 5 s even for a hung capture. The 5 s read
  (`inspect`) renews nothing, so a hung capture still loses its lease; renewals come only from
  progress, throttled to one per 30 s (or a third of the lease). The default lease is 5 minutes.
- **Retries.** `testing.retries`, default 2 (three attempts in total), on every path including
  in-process capture. The backoff, 1 s doubling to a cap of 30 s, is an internal constant. One limit
  covers failed attempts, lost leases and child crashes.
- **Serverless check.** With `testing` set, startup refuses when the signal is certain
  (`AWS_LAMBDA_FUNCTION_NAME` exists only at Lambda runtime) and warns when it is not (`VERCEL` is
  also set during builds). `STORYSHELF_ALLOW_SERVERLESS=1` overrides a wrong refusal.
- **Resource sharing.** Web requests and capture work share an instance's CPU; operators limit
  `concurrency` and `compare.threads`, or add instances.

## Consequences

**Positive**

- One deployable and one copy of the configuration. Database and storage credentials live only in
  the app. With remote browsers, customers' Storybook JavaScript runs in a browser that holds none;
  with local engines the browser is a child of the app.
- Horizontal scaling is safe: jobs are persistent, leased and redelivered, and recovery does not
  assume a single instance.
- One queue with one set of semantics, and a cross-instance live queue view. Publishing, capture and
  durable git-host delivery share it.
- Hosting-only is a clean, documented mode, and `testing` is the single switch for the checks.

**Negative**

- A broad breaking change for existing deployments: the option shape, the retired worker and queue
  packages, and no serverless deployment with `testing`. Operators using SQS or Redis queues move to
  the database queue or supply their own `PollableCaptureQueue`.
- Lease code carries the race risks of any lease implementation and relies on the contract suite and
  multi-instance tests.
- Database polling and lease writes grow with instance count; unmeasured, and for Turso also a
  billing question.
- Web requests and capture share CPU.
- Route gating spans many routers, and the API surface depends on configuration and on a project
  setting.
- `approved` does not imply that a person or a check approved a build: an automatically accepted
  hosting-only build is `approved` with no snapshots, which is why the UI labels it "Published".

## Alternatives considered

- **A separate worker role (`render: false`).** No use case once rendering scales in the farm; cheap
  to add if one appears.
- **First-party queue adapters.** Four packages of maintenance for a case the database covers; the
  interfaces stay for anyone who needs one.
- **An in-memory queue for single instances.** A second code path with different semantics, to save
  a few row writes next to hundreds of snapshot rows per capture.
- **A render service** (`CaptureRunner.render` over HTTP, keeping page pooling). Providers such as
  Azure and BrowserStack cannot use it, so it would be a second mechanism (ADR 0007).
- **Other names for the option:** `visualTesting` (too narrow: it also runs `play` and accessibility
  checks), `checks` (generic), `quality` (vague).
- **Review as part of `testing`, or an instance-level `review` option.** Rejected in ADR 0013: review
  must work without renderer infrastructure, and a project admin owns the decision.

## Open questions

- How Turso and other hosted SQLite meter an idle indexed poll, measured against the acceptance test
  in decision 11. What is established: the probe is an index search that reads no rows when idle
  (hermetic test on SQLite, and a gated live test of the query plan on Turso), and an idle instance
  sends at most one probe per 15 s, about 5,800 requests a day. The billed row reads per probe still
  need a measurement on a Turso account.
- Whether extraction can stream straight into storage with no scratch disk, which would let a
  serverless host publish a zip too.
- Whether Vercel exposes a runtime-only signal, so the serverless check can refuse there too.
- The catalog and `build_components` shape: size on very large Storybooks, and whether component
  rows should store more than a hash.
- Whether Storybook 8 to 10 previews run in a sandboxed iframe without `allow-same-origin`; settled
  before the embed ships.
- Whether a bare `playwright run-server` has built-in authentication or a concurrency cap; settled by
  the test against a self-hosted Playwright server (ADR 0007).
- Whether rolling upgrades with mixed versions need support later; the upgrade is stop-the-world.
