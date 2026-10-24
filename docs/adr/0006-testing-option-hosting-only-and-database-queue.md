# ADR 0006: Testing Option, Hosting-Only Mode and the Database Queue

## Status

Accepted. Amended with the `capture_jobs` table, claim algorithm, poll/cancel details and the
`notify` job kind (decisions 4, 5 and 11), recorded while implementing #212, #217 and #222.

Supersedes (archived): ADR 0034.

## Context

StoryShelf hosts published Storybooks and runs checks on them (visual diffs, `play` tests,
accessibility). Checks need a renderer, image engine, job queue and long-running work; hosting needs
none. This ADR fixes how one deployable offers both, how it runs with checks off, and how background
work is queued.

The forces:

- **One option for one feature.** Capture, compare, baselines and the testing status are stages of
  one feature, so they are configured together.
- **No second deployable.** A separate worker needs database, storage, secret and runner configured
  twice; drift bugs follow, and credentials sit next to customers' Storybook JavaScript.
- **One queue, safe with many instances.** Multiple transports carry their own lease/retry
  behaviour, and a boot sweep that requeues in-flight builds is unsafe with a second instance.
- **Scale-out happens in the browser farm** (ADR 0007).
- **Hosting-only is real**, including on serverless platforms, and must publish, catalogue and show
  Storybooks without a capture pipeline.

## Decision

### 1. `testing` is the umbrella option; absent means hosting only

`ShelfOptions.testing` covers capture, compare, baselines and the testing commit status. It requires
`runner`; there is no enqueue-only configuration. It carries `runner`, `compare`, `images`,
`concurrency`, `shardSize`, `retries`, `storybookUrlRateLimit`, `workerEntry` and `mode`. `compare`
and `images` live here because their outputs exist only with capture. `scratchDir` stays in
`config` because publishing uses it too.

- **Absent `testing`:** hosting, publishing, projects, tokens, members, labels, webhooks and the
  build/library/component pages work. Capture, compare, snapshot review, baselines, the
  `<prefix>/testing` status, capture settings, compute-jobs and snapshot-reading features are off.
  `<prefix>/storybook` is still posted; with review on, `<prefix>/review` (ADR 0014).
- **Hosting-only is not open access.** Auth rules (ADR 0011) apply unchanged; route classes gate
  features, never access.
- **Mechanism:** one store flag, `requireTesting` per route, and the same classification driving
  navigation, MCP tools and the OpenAPI marker. Disabled endpoints answer 404.
- **Existing data is hidden, not deleted.** Startup logs the mode; the System page shows a notice
  and the hidden snapshot count. CLI upload output says the Storybook was published but no checks
  will run.

### 2. Review is a project setting, and the auto-accept rule

Review is independent of `testing`: `projects.review_enabled` (default on), edited by project
admins; there is no instance option. ADR 0013 owns the design. This ADR fixes acceptance:

- **Default branch: always accepted.** With `testing` off the build is `approved` when publishing
  finishes. With `testing` on it is `approved` when capture finishes and changes are auto-approved,
  unless capture failed. The default branch is never held, so the project link always resolves.
- **Other branches, `testing` off:** accepted at publishing only if review is off. With review on,
  the build waits as `pending` for a build-level verdict.
- **Other branches, `testing` on:** the snapshot rollup decides.

An automatically accepted build fires no approval event; `build:created` already announces the
upload. A publishing failure becomes `failed`.

### 3. `testing` requires a long-running server

Capture runs for minutes and the consumer keeps running between requests, so `testing` needs a
container, VM, Fly Machine, Kubernetes pod or similar. Platforms that freeze or end the process
after each request (Vercel Functions, AWS Lambda, Cloudflare Workers) can host Storybooks only.
Cloudflare D1, a Workers-only binding, cannot back `testing`; Turso over the network can.

Hosting-only serverless publishes through `/dedup`, `/content`, `/manifest`, which needs no
extraction or scratch disk (ADR 0003). A zip that cannot be extracted inline is rejected at upload
with that explanation, not left pending (decision 10). Every instance with `testing` enqueues and
consumes; there is no API-only role (`render: false`). Rendering scales in the browser farm.

### 4. The database is the queue

`capture_jobs` (DDL for SQLite, Postgres and MySQL) holds one row per job. Kinds are `capture`
(including shards), `publish` (decision 10) and `notify` (durable git-host state, ADR 0014).
`Tables` gains `captureJobs` and `buildComponents`; this breaks third-party `DatabaseAdapter`
implementations, which is accepted.

- **Job rows and shard rows:** a shard job references its `capture_shards` row (ADR 0005). The job
  holds delivery state; the shard holds the capture result and its kind (plan, render, finalize).
- **Claim and fencing without compare-and-swap:** each attempt is its own row,
  `<jobId>:<attempt>`, created by a unique-key insert, holding owner, lease expiry and result. A
  holder writes only its attempt, so a stale holder cannot overwrite a newer lease. When a lease
  expires, any instance inserts the next attempt. A job is done once any attempt is `done`; a later
  attempt notices at its next progress touch and stops. Work is idempotent per attempt.
- **One table, two row kinds:** job rows (`entry = 'job'`) and attempt rows
  (`entry = 'attempt'`) share the indexed visibility column, so one query finds a queued job or an
  expired lease. The job row holds kind, build/shard, attempt count, status, `visible_at`, payload
  and cancel flag; the attempt row holds the fence id, copied kind/build/shard, attempt number,
  status, lease expiry, owner and timestamps. No foreign keys; retention purges finished rows.
- **The claim:** probe the oldest candidate, insert the next attempt; one instance wins. The winner
  re-reads the job, gives the claim back if it ended or was cancelled, and marks it `running`; a
  loser waits for the lease and moves `visible_at` forward without changing status. Renewal updates
  only the holder's attempt; a stale nack writes nothing, a valid nack requeues/fails/cancels, and
  an ack marks attempt and job `done`. Past `max_attempts` the job fails; a late `done` wins.
- **`notify` jobs** differ: the job states `maxAttempts` (five) and the handler its own retry delay
  (10 s doubling to five minutes); they run on a second queue/consumer so capture cannot starve a
  status. Queue views list every polled kind but `notify`.
- **Leases** are kept by a heartbeat every `min(30 s, lease / 3)` and by throttled progress, so a
  silent stage is not redelivered. `testing.leaseSeconds` defaults to 300. Renewal stops on
  completion, lost lease and cancel.
- **Enqueue** inserts and wakes the local consumer; other instances find the job on their next
  poll. **Retry/failure:** past `testing.retries` the job fails and the build takes the standard
  terminal path. A final attempt that loses its lease calls `onExhausted(job, error)` (idempotent,
  any instance): capture fails the build (`failCrashedCapture` + alert), publish completes as
  failed.
- **Cancel** flags the job; the running instance reads it and calls `runner.cancel`. It works
  across instances and for a hung capture; a not-started job is immediate.
  `CaptureQueue.cancel(jobId | buildId)` cancels unfinished jobs of every kind and flags the running
  attempt; `LeaseRenewal` gains `"cancelled"`. The API/UI is
  `POST /api/v1/projects/:slug/builds/:id/cancel` (class `testing`, developer+) and **Cancel
  build** while `pending`, `capturing` or `comparing`: jobs are cancelled first, open attempts end
  `cancelled`, then the build becomes `cancelled` through `announceBuildStatus`. Git channels map
  it (GitLab `canceled`, GitHub `error`, description `Cancelled`), `build:cancelled` is a webhook
  and non-default notification topic, and no `build:failed`/`sys:capture-failed` fires.
  `cancelled` is terminal: `BuildModel.update`/`setStatus` refuse other statuses,
  `CaptureAttemptModel` keeps cancelled attempts, `finalizeBuild`/the orchestrator skip it, snapshot
  approval and build verdicts answer 409, and only retry (`resetStatus`) leaves it. Cancelled builds
  are purged like failed ones and never published/accepted. Jobs are cancelled and attempts closed
  before the status write to keep the race window to one in-flight write.
- **Views/traces/retention:** `status`, `active` and `recent` read the table; `traceparent` and the
  request id travel in the job; finished rows are purged with retention. **Backends:** any adapter
  with a distinguishable unique-key insert. Postgres (all presets, including `neon-http`), MySQL and
  Turso support many instances; local SQLite and `pglite` support one host; D1 is excluded.

There is no in-memory production queue and no boot sweep; lease expiry and redelivery recover work.
**Upgrade:** no migration sweep; a build left `capturing`/`pending` with no job row is retried by
hand, and mixed versions are unsupported. A test double may remain.

### 5. No separate worker; the consumer runs in the app

There is no `@storyshelf/worker`. The consumer lives in `@storyshelf/core/capture` and runs in
every app instance with `testing`: poll, heartbeat/progress lease, retry with backoff, final-attempt
rule, cancel the local run on lease loss, drain on SIGTERM. A slot is taken before polling; a
failing job waits `1000 ms * 2^attempts` (max 30 s); `attempt >= maxAttempts` is the last attempt,
nacked without requeue. A job without a handler fails clearly. Constants live in
`consumer/retry.ts`. Credentials exist only in the app, with one configuration copy.

**Forked capture** remains opt-in for local engines on one machine. The parent consumes and pushes
leased jobs over IPC (`run`, `cancel`); the child's `progress` renews the lease and `done`/`failed`
settle it. The child never reads the queue and inserts shard jobs itself; `runCaptureChild` is
exported from `@storyshelf/core/capture`. The child is inside the app's trust boundary. It receives
no new investment; child restarts and hang kills are counted, and it retires when local engines stop
being recommended or metrics show no capture-caused restarts.

### 6. No queue adapters and no queue option; the interfaces stay

There are no `queue-sqs`, `queue-redis`, `queue-azure` or `queue-gcp` packages; they are retired
through `docs/deprecated.md` once the database queue passes the contract suite, multi-instance tests
on Postgres/MySQL/Turso, and a same-host test on local SQLite. There is no `testing.queue`: the
database queue is the only queue, and `testing` without `runner` throws. `CaptureQueue` and
`PollableCaptureQueue` and the contract suite stay exported for the database queue and the forked
child.

The queue asks one thing of the adapter: a unique-key insert whose conflict can be told apart,
already used by the finalize claim. External queues were weighed: hosted multi-tenant scale is the
one strong case, not the self-hosted product; autoscaling and operator policy are covered by
exported metrics, `failed`, the admin view and alarms.

### 7. The browser farm is the scale-out unit

Rendering scales by adding sessions in a browser farm (ADR 0007). A self-hosted farm needs no
StoryShelf package: the official Playwright image running `playwright run-server`, pinned to
StoryShelf's `playwright-core`, or Browserless, with a token and concurrency cap. A guide test
fails when its pin drifts; a connect-time error names both versions. A story calling an internal
service needs a farm inside that network.

### 8. Every route is classified, and a test keeps it that way

Routers mix kinds of route, so the gate is per route. One route table classifies every route into
four classes; the lists are representative, the table is full.

- **`hosting`** (with or without `testing`): projects, tokens, members, labels, auth, webhooks;
  build upload (zip/dedup/content/manifest), listing and delete; Storybook serving.
- **`testing`** (404 without `testing`): snapshots (list/approve/reject/approve-all/reject-all/
  rediff/per-mode), snapshot media and design renders, baseline export/import, attempts and logs,
  status configs, insights (also need `ai`), capture/status/test settings, compute-jobs, build retry
  and the diff page. Retry is `testing` because it sets `pending` and enqueues capture.
- **`both`** (present in both, gated sections): build list/detail (snapshots, statuses and attempts
  only with `testing`; build comments/verdicts in both), library and component pages (decision 9).
  `/projects/:slug` redirects to the library.
- **`review`** (404 when the project's review switch is off, with or without `testing`): comments,
  build verdicts, changeset, the build page's review section and review settings. The gate reads the
  project setting per request; ADR 0013 defines the routes.

Two tests keep the table honest: every registered route is classified; booting without `testing`
makes every `testing` route 404 and no `hosting` route, and a review-off project makes every
`review` route 404. The same table drives navigation, MCP tools (ADR 0017) and the OpenAPI marker.

### 9. Library, component and build pages come from Storybook metadata

`index.json` is the primary source in both modes; `testing` adds data without changing the skeleton.
The library shows the selected branch's latest build whatever its status, components grouped by
title and links into the published Storybook. The component page adds stories/docs entries, project
design links (ADR 0018), build history and changed/added/removed detection. The build page shows
catalog metadata; snapshots, statuses and attempts need `testing`, while comments and verdicts do
not.

- **Acceptance is required, not cosmetic.** The project Storybook link and upstream links resolve
  only accepted builds, and retention purges terminal builds, so a hosting-only build must reach a
  status under decision 2. A `pending` non-default build keeps the previous accepted links until
  approved; its own URLs answer to viewers. Enabling `testing` later leaves accepted builds as they
  are; the next default-branch build bootstraps baselines.
- **Data:** publishing writes a compact catalog next to statics and one `build_components` row per
  component (project, build, import path, title, story count, entry hash). The catalog serves the
  pages, cached by build id; the table answers "which builds contain this component and did it
  change" with one indexed query and feeds the changeset (ADR 0013). Both purge with the build;
  older builds are catalogued lazily on view. Upstream links use snapshots when present, else the
  catalog.
- **Resolved parameters are not in `index.json`.** Per-story design links and modes come only from
  capture's `extractParameters`; without `testing` their absence is not an error. Reading them from
  the preview was rejected (internal channel across SB 8-10); recording them at publish needs a
  browser.
- **Embedding is a security decision.** Path-based serving puts customer JavaScript on the app
  origin (ADR 0010), so the embed uses the separate published origin when configured, otherwise
  click-to-load in a sandboxed iframe with a link out.

### 10. Publishing does not depend on `testing`

File-by-file publishing completes when the manifest is stored, writing the catalog from the stored
`index.json`; with `testing` the manifest route enqueues capture, without it the build is accepted
under decision 2. A small zip is extracted inline; a larger one becomes a `publish` job on the
database queue with the lease/retry/redelivery of decision 4, consumed by any long-running instance
with scratch space. A hosting-only instance on such a host runs the consumer for `publish` and
`notify`; `testing` adds `capture`. With no consumer, a zip over the inline limit is rejected at
upload pointing to file-by-file. Extraction caps entry count and total uncompressed bytes;
compressed size alone is no bound.

`maxInlineUnzipSize` has a safe default. Publishing ends by writing the catalog and, with `testing`
off, applying decision 2 (`approved`, `pending` for review, or `failed`), posting
`<prefix>/storybook`. With `testing` on, capture backfills statics and the pipeline decides status.

**Upgrade:** with `testing` off, a boot task accepts pre-design `pending` builds that have a
zip/manifest and no attempts, and fails the rest. With `testing` on, decision 4's sweep gives them
job rows.

### 11. Operating details

- **Polling:** no poll while all slots are busy. Otherwise every 15 s idle and every 2 s after
  recent work, with jitter (up to +20 %), so idle stays ≤ one probe per 15 s and reads no rows.
  "Recent" means found/queued locally in the last 60 s. A local enqueue wakes the poll at once.
- **Cancel:** each running job reads its row every 5 s; lease renewal also returns it, so cancel
  latency is about 5 s even for a hung capture. `inspect` renews nothing.
- **Retry timing:** a requeued job is claimable after backoff but the poll wakes only on local
  enqueue, so it runs at the next poll (≤2 s active, 15 s idle).
- **Retries:** `testing.retries` defaults to 2 (three attempts) on every path including in-process
  capture; backoff is 1 s doubling to 30 s. One limit covers failed attempts, lost leases and child
  crashes.
- **Serverless check:** startup refuses on `AWS_LAMBDA_FUNCTION_NAME`, warns on `VERCEL`/`NETLIFY`;
  `STORYSHELF_ALLOW_SERVERLESS=1` overrides a wrong refusal.
- **Resource sharing:** web requests and capture share CPU; limit `concurrency` and
  `compare.threads`, or add instances.

## Consequences

**Positive**

- One deployable and one configuration copy; credentials live only in the app. With remote
  browsers, customer JavaScript runs in a browser holding none; with local engines it is a child of
  the app.
- Horizontal scaling is safe: jobs are persistent, leased and redelivered; recovery assumes no
  single instance.
- One queue with one semantics and a cross-instance live view; publishing, capture and durable git
  delivery share it.
- Hosting-only is clean and documented; `testing` is the single switch.

**Negative**

- Broad breaking change: option shape, retired worker/queue packages and `testing.queue`, and no
  serverless `testing`. SQS/Redis users move to the database queue.
- Lease code carries race risks and relies on the contract suite and multi-instance tests.
- Database polling/lease writes grow with instances; unmeasured, and a Turso billing question.
- Web requests and capture share CPU.
- Route gating spans many routers; the API surface depends on configuration and a project setting.
- `approved` does not imply a person/check approved: an auto-accepted hosting-only build is
  `approved` with no snapshots, hence "Published".

## Alternatives considered

- **A separate worker role (`render: false`).** No use case once rendering scales in the farm.
- **First-party queue adapters.** Four packages for a case the database covers; interfaces stay.
- **In-memory queue for single instances.** A second semantic path to save a few row writes.
- **A render service over HTTP.** Azure/BrowserStack cannot use it, so it is a second mechanism.
- **Other names:** `visualTesting` (too narrow), `checks` (generic), `quality` (vague).
- **Review inside `testing`, or an instance `review` option.** Review must work without renderer
  infrastructure, and a project admin owns the decision (ADR 0013).

## Open questions

- How Turso meters an idle indexed poll. The probe reads no rows when idle (SQLite test and a
  gated Turso query-plan test), at most one per 15 s (~5,800/day); billed reads need measurement.
- Whether extraction can stream straight into storage, enabling serverless zip publishing; whether
  Vercel exposes a runtime-only signal; catalog shape at very large Storybook size; whether SB 8-10
  previews run sandboxed without `allow-same-origin`; whether a bare `playwright run-server` has
  authentication/concurrency limits; whether rolling upgrades need support (currently
  stop-the-world).
