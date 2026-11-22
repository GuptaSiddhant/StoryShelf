# Testing Strategy

## Principles

- **Fast and hermetic by default.** `nub run test` (vitest) must never need a browser, network, or a Storybook build. Browser coverage is gated.
- **Constructor injection makes this possible.** Models take adapters in their constructor (ADR 0001), so unit tests pass in-memory SQLite (`:memory:`), a temp-dir storage, and fakes for capture/auth/status.
- **Assert behavior, not lines.** The 100%-coverage target (AGENTS.md) applies to models, routers, adapters, and the diff engine. The browser-integration path is asserted behaviorally.

## Determinism

Timing and concurrency tests must assert causality, not wall-clock speed:

- Hold work at a barrier (`createLatch`/`deferred` in `@storyshelf/core/test-helpers`) and assert the in-flight state; release it and assert the outcome. Do not `sleep(5)` to make a race "probably" happen.
- Drive timers through the seam under test: an injected clock/timers, or a spy on `setTimeout`/`setInterval` that records the delay, then assert the branch that ran. Do not assert elapsed milliseconds. `vi.useFakeTimers()` currently conflicts with the Node 24 Temporal polyfill in this workspace (`Cannot redefine property: Now`), so use the injected/spied seam instead. Use the real clock only at an outer polling boundary (`vi.waitFor`) where the system itself is asynchronous.
- Polling an external callback is fine; polling to create a window for a bug is not.
- Never quarantine a timing test with `skip` to get green. If a test genuinely measures throughput, move it to a bench/nightly timing tier.

The touched timing-sensitive files have a `test:flake` script in their package: they repeat at `--maxWorkers=1 --no-file-parallelism`, which the nightly `flake` job runs uncached. This is the canary for scheduler assumptions; it is not a PR gate.

## CI selection tiers

- **PR required gate:** `turbo verify --affected` includes changed packages and their dependents. Root/global files, package manifests, workflow/config changes, a missing diff, or the `ci:full` label force the full suite. Test tasks run at `TURBO_CONCURRENCY=1`: the Postgres/PGlite suite spawns many memory-heavy workers, and overlapping package suites have been OOM-killed on the runner.
- **Push to `main`:** full `turbo verify --filter='!website'` with the turbo cache, so a task whose inputs did not change replays; `--force` (uncached) when the push changes a file that decides every task's hash (root manifests, lockfile, `turbo.json`, tsconfig, config, workflows, scripts, a package's manifest or build config). The nightly forced run backstops a wrong cache input.
- **Nightly:** the same full uncached verify plus `turbo run test:flake`, every Storybook fixture, and the Fly dry run. It is the backstop for anything `--affected` could miss.
- **Storybook dev smoke (`storybook-dev` job):** `nub run smoke:storybook` in `packages/app` starts `storybook dev`, opens every story once in Chrome and fails on a page error, a console error or Storybook's error display (`scripts/storybook-dev-smoke.mjs`). `turbo verify` only builds Storybook, and the production build tree-shakes code the dev server still runs, so a shim or story can build and still throw for anyone running `nub run storybook`. Runs only when `packages/app`, `packages/core`, the lockfile or `ci.yml` changed.
- File-level `vitest --changed` is deliberately not a required gate: dynamic imports and cross-package resolution can miss a test. Use it only as an advisory experiment, with the nightly full run as the safety net.

## Layers

### 1. Unit (vitest, colocated `*.test.ts`, CI-always)

- **Models** — baseline resolution (per-branch fallback chain), accept/reject, purge candidate selection (terminal + TTL + keep-latest-per-branch + `persistent` exemption + orphan GC + branch GC via `purgeStaleBranches` TTL + default-branch exempt), labels (URL-safe values, latest-build resolution, `persistent` non-removable).
- **Diff engine** — committed fixture PNGs (identical, differing, size-changed) assert `diffPixels`/`diffRatio`/overlay bytes.
- **Routers/handlers** — Hono request/response against in-memory DB + fake storage; auth/role middleware with a stub `Auth`.
- **Capture `discover()` / `buildUrl()`** — parse a committed `index.json` fixture; URL-safety (encodeURI + wildcard value segment).
- **URL builder** — path vs subdomain forms, label/branch encoding.

### 2. Adapter contract tests

Each adapter against its interface: SQLite via `:memory:` (Turso via a local libSQL stub), local storage (core's `storage/local`) via a temp dir, `@storyshelf/storage` (`/s3`, `/gcs`, `/azure`) via recorded/fake clients, plus `peer-isolation.test.ts` (each subpath imports with only its own SDK resolvable), auth via the engine adapter over `:memory:` SQLite.

> Known environment limitation: `@libsql/client` (native binding ≤ 0.5.29)
> segfaults at process teardown on current Node majors — even on a bare
> `createClient({ url: "file:…" })` + `SELECT 1`. The Turso tests themselves
> pass; the vitest worker then dies with `SIGSEGV`, failing the file. This
> is upstream (`tursodatabase/libsql-client-ts` native instability), not a
> repo regression: it reproduces on a pristine checkout with one client and
> no test framework involved. If `db-sqlite` goes red with a worker
> `SIGSEGV` in `turso.test.ts`, check the native binding first.

#### 2a. Per-adapter testing requirements (mandatory)

Every adapter package must satisfy this matrix. New adapters ship with all
rows; existing adapters backfill on touch. The `adapter-layout` skill enforces
the file placement (colocated `<module>.test.ts`, move cases with the code).

| Requirement                                   | Storage (`@storyshelf/storage`)                                                                          | DB (`db-*`)                                                | Runner / git / auth / notify                               |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| `metadata`                                    | `kind` + `category` asserted once per factory                                                            | same                                                       | same                                                       |
| `lifecycle` all-or-nothing                    | `setup` creates root (idempotent x2), `health.ok` true then false after `rm -rf`, `teardown` x2 no-throw | `migrate` twice + `ping` ok, `close` x2 no-throw           | same shape; runners assert browser launch/close            |
| Happy-path operations                         | `write/read/exists/delete/list` round-trip + recursive `list` + missing prefix `[]`                      | CRUD per table + unique-constraint + foreign-key violation | render/post/comment round-trip via fake transport          |
| Not-found / error mapping                     | `read`/`readStream` missing → throw; `writeStream` failure deletes partial                               | missing row → `undefined`, not throw                       | HTTP 4xx mapped to typed error, 5xx retried per `httpJson` |
| Safety                                        | path-traversal (`../escape`) rejected on `read/write/list`                                               | SQL injection via values rejected (params, never concat)   | webhook HMAC verified before mutation                      |
| Streams / codec where applicable              | `writeStream/readStream` byte-identical + partial cleanup on failure                                     | N/A (or bulk-import performance smoke)                     | runner screenshot bytes equal fixture hash                 |
| Live (`*.live.test.ts`, `LIVE_CLOUD=1` gated) | real bucket round-trip with `live/<run-id>/` prefix                                                      | real migrate + CRUD, teardown drops test rows              | real API against throwaway repo/SHA                        |

Rules:

- Fake the transport, never the adapter: inject fake S3/pg clients,
  temp dirs, or `:memory:` DBs. No network in `nub run test`.
- Prove conformance with the published suites: `storageContractSuite` /
  `databaseContractSuite` from `@storyshelf/core/test-helpers` (one line in
  the package's own test file). `queueContractSuite` covers the database queue; runner/git suites follow in later phases).
- A database that implements `buildReferenceLifecycle` (build retention, ADR 0039) proves it with
  `buildReferenceContractSuite` from `@storyshelf/core/test-helpers`, one call in the package's own
  test file. The fixture hands the suite two lifecycles on **independent connections** (one
  connection used twice proves nothing about locking), an owner, two `available` builds of its
  project, and a `marker` (a domain write inside a mutation and a count of committed ones, read
  through a connection other than the transaction). The suite also pins the typed
  `ReferenceGenerationConflict` for a stale generation. A stand-in that serves every connection
  from one session (an in-process Postgres such as PGlite) can run the suite but cannot prove
  cross-connection row locking; say so where it is used, and prove locking against a real server
  before enabling the capability on a preset.
- Postgres (`db-postgres/src/build-reference-lifecycle.test.ts`) runs `buildReferenceContractSuite`
  twice. On PGlite it always runs and proves the SQL, the constraints and the rollback of domain
  writes, but both lifecycles share one session, so it does not prove locking (removing the row
  locks leaves it green). On a real server (one connection per lifecycle) it does: removing the same
  locks fails it. That half needs `LIVE_CLOUD=1`, `DATABASE_URL` and `POSTGRES_SCHEMA_MUTATION_TEST=1`;
  the last says the database is disposable, because the suite clears `content_uses` and its
  collector pass claims every idle hash. CI runs that half on every pull request that
  touches `packages/db-postgres/`, `packages/core/src/test-helpers/` or
  `packages/core/src/adapters/database.ts` (job `postgres-lifecycle`, a `postgres:16` service
  container), and the nightly database workflow runs it with the rest of the live suite.
- The `pg` and `./neon` presets (`db-postgres/src/retention-pool-presets.test.ts`) run both suites on a
  real server with every party on its own pool; `./neon` goes through a `ghcr.io/neondatabase/wsproxy`
  service (`NEON_WSPROXY`), and the file skips without the gates. A single injected connection staying off is hermetic.
- Postgres activation (`db-postgres/src/retention-activation.test.ts`) runs `retentionActivationContractSuite`
  the same way: PGlite always, a real server (same gates, same CI job) for the rest. Only the real server
  runs the mirrored race tests (an interrupted preparation that resumes, a fenced writer in flight, two
  instances booting). The unit test pins that PGlite never exposes the capability.
- MySQL (`db-mysql/src/build-reference-lifecycle.live.test.ts`) has no in-process stand-in: it runs
  `buildReferenceContractSuite`, `retentionActivationContractSuite` and `retentionSkippedContractSuite`
  only against a real MySQL 8 server, every party on its own pool, plus the mirrored race tests
  (interrupted preparation, a writer in flight, two instances booting, a claim against preparation)
  and a use of a hash racing a collector's claim. Gates: `LIVE_CLOUD=1`, `MYSQL_SCHEMA_MUTATION_TEST=1`
  and `MYSQL_DATABASE_URL` (a user that may `CREATE DATABASE`: the skipped-build cases each get a
  scratch database). CI runs it on every pull request that touches `packages/db-mysql/`,
  `packages/core/src/test-helpers/` or `packages/core/src/adapters/database.ts` (job `mysql-lifecycle`,
  a `mysql:8.0` service container), and the nightly MySQL job runs it with the rest of the live suite.
  Removing the row locks or the named content locks fails it. The hermetic half
  (`retention-activation.test.ts`) only refuses: MariaDB, TiDB, Vitess, MySQL other than 8, statement
  binlogs, non-InnoDB tables, a single injected connection and the PlanetScale and TiDB presets.
- The boot step that prepares the baseline pins before a dialect exposes the capability (ADR 0039,
  "activation") is proven with `retentionActivationContractSuite`. Activation stays each adapter's
  own step (it is on neither `DatabaseAdapter` nor `BuildReferenceLifecycle`); the dialect hands
  the suite a harness: its own `prepare()` (resolving to the pause, if any), a lifecycle on its own
  connection, and seeding and reading of baselines. The suite pins what must hold in every dialect:
  a source is never guessed, a recorded source whose build is gone is kept unpinned, a stale pin is
  released, and a tombstoned or other-project source pauses retention and rolls back every pin.
  What needs a dialect's own internals stays in that dialect's tests and must be mirrored for each
  new one: the interrupted preparation that resumes after a restart, and the fenced writer racing
  preparation.
- Core validates untrusted input at the boundary: storage path segments
  (`paths.ts`), screenshot bytes (`capture/guards.ts`: PNG magic + 25 MiB cap),
  list limits (`clampListLimit`, max 1000).
- Idempotency is asserted, not assumed: run `setup`, `teardown`, `migrate`,
  and `enqueue`-retry twice.
- Indirect coverage allowed only for pure mappers (e.g. the git integration
  `github-mapper.ts` precedent); everything else has a direct colocated suite.

### 3. Integration (vitest, CI-always)

`createShelfApp({ database, storage, testing: { runner: <fake> } })` drives the full `upload → capture → diff → review → approve` flow over HTTP. Capture is a fake runner here (a real one needs a browser).

### 4. Browser integration (gated: `nub run test:integration`)

- **Visual (all fixtures; PRs run `storybook-9` only when the change touches more than docs, the website, Markdown or fixtures 8 and 10; the nightly workflow runs 8, 9 and 10):** Runs the real capture pipeline (`@storyshelf/runner`) against a built Storybook fixture in `fixtures/storybook-8` (default, 7 stories), `fixtures/storybook-9`, and `fixtures/storybook-10` (each independent `pnpm` install, built on demand `pnpm install && pnpm run build-storybook`; `storybook-static/` is `.gitignored`). Override locally with `FIXTURE_DIR=fixtures/storybook-9`. Requires Playwright browsers (one-time provision: `npx -y playwright@1.63.0 install chromium`). Gated so `turbo test` stays browser-free.
- **Interaction (`play`, only oldest):** When a project has `executePlay: true`, the same suite runs `play` functions before screenshots. Tested only against `fixtures/storybook-8` (oldest) unless a major changes the `play` channel — then add a single `play` smoke for that major. Verified: `BlockingFailure` → whole build `failed`, `FlakyTag`/`FlakyParam` (`flaky-test`) → non-blocking `reviewing` with warning, `Disabled` (`skip`/`disableSnapshot`) → not counted.

- **Settled signalling and `.test()` runs (`settle.integration.test.ts` in the Playwright runner):** on any fixture, a render waits for Storybook's own event (no fallback warning, identical re-captures, the play error of a flaky story is reported), falls back to the fixed wait on a page with no channel (immediately) and on a silent channel (after the 5 s timeout), and `runTests` reports pass or fail per `.test()` entry. Only `fixtures/storybook-10` has test entries (`renders its label` and `clicks without error` pass, `fails on purpose` fails; written as bare `Primary.test(...)` statements, because the indexer ignores an exported call), so the Playwright suite also runs a build with `runTests` on (the failing test fails the build, results are stored, no snapshot is taken for a test) and one with it off (nothing stored). On Storybook 8 and 9 the same tests assert the no-op. The failing test needs no tag: it is inert unless a project turns `runTests` on, which only these tests do.

- **Browser golden path on the Fly container (`apps/fly-app/e2e/golden-path.test.ts`, gated: `SHELF_E2E=1`; issue #941):** the seams the `app.request(...)` suites cannot see (the sign-in cookie, CSRF, HTMX swaps, keyboard review, response headers, a private published Storybook, the read-only demo account) tested in Chromium against the production image the Fly dry run already boots. It adds no server of its own. With `e2e: true`, `fly-dry-run.yml` boots the image with password sign-in, `SHELF_SECRET`, a confirmed `SHELF_PUBLIC_BASE_URL`, `SHELF_READ_ONLY_ACCOUNTS` and a throwaway `SHELF_DEMO_VIEWER_PASSWORD`; the seed (`seed.sh`) seeds no demo project (#1275), so the spec creates its own with the admin token, uploads a baseline `main` build of the built `storybook-9` fixture and approves it, adds a `git-log` channel and uploads a feature-branch copy with one story repainted by a CSS patch (workspace CLI); waits on the API until the build settles with one `changed` snapshot; signs in through the login page; opens the build (the changed count) and the comparison, and approves with `a`; asserts the verdict through the API and, from `docker logs`, the structured `git state (log)` record (`state: "success"` for the build's commit on the `/testing` context; the `git-log` provider is the only git provider registered in `apps/fly-app/instance.ts` and writes to the log only, so there is no outbound call); checks the build is private (anonymous request refused) and opens its Storybook as the signed-in user; signs in as `demo@storyshelf.js.org`, sees `storyshelf-ui` but not the spec's project, and gets 403 on a profile and a comment write; and runs axe on each app page it visits, failing only on serious or critical violations. Every wait is on API, log or DOM state: no sleeps and no retries. A failed run leaves a Playwright trace in `E2E_TRACE_DIR`, uploaded as the `e2e-trace` artifact, and the job prints `docker logs`.

  | Trigger                         | Fly dry run               | Browser step (`e2e`)                                        |
  | ------------------------------- | ------------------------- | ----------------------------------------------------------- |
  | Pull request                    | as before (heavy changes) | off                                                         |
  | Pull request from `release/v*`  | always (forces `heavy`)   | on, so it gates the release through the required `ci` check |
  | Push to `main`                  | as before                 | off                                                         |
  | `nightly.yml`                   | as before                 | on                                                          |
  | `workflow_dispatch` on `ci.yml` | as before                 | on                                                          |

  To run it locally against `docker run` (from the repo root; needs Docker, `curl`, `jq`):

  ```sh
  nubx turbo build --filter=storyshelf
  (cd fixtures/storybook-9 && pnpm install && pnpm run build-storybook)
  docker build -f apps/fly-app/Dockerfile -t storyshelf-fly .
  docker run -d --name storyshelf -p 3000:3000 -e SHELF_ADMIN_TOKEN=ci-admin-token \
    -e SHELF_SECRET=e2e-secret-that-is-long-enough-1234567890 -e SHELF_ADMIN_EMAIL=reviewer@example.com \
    -e SHELF_ADMIN_PASSWORD=e2e-password-123 -e SHELF_PUBLIC_BASE_URL=http://127.0.0.1:3000 storyshelf-fly
  export SHELF_URL=http://127.0.0.1:3000 SHELF_ADMIN_TOKEN=ci-admin-token
  apps/fly-app/seed.sh                                  # then wait until the demo builds settle
  npx -y playwright@1.63.0 install chromium             # one-time
  (cd apps/fly-app && E2E_EMAIL=reviewer@example.com E2E_PASSWORD=e2e-password-123 nub run test:e2e)
  docker rm -f storyshelf
  ```

### 5. Performance benchmark (manual: `nub run bench`)

`scripts/bench/` measures the real app on `fixtures/storybook-9` (SQLite, local storage, Playwright at 2 pages, jobs at concurrency 1) and prints a table plus one JSON line. It is not part of `turbo verify` or `turbo test`; it needs Chromium and the built packages. Every Performance task reports its before and after with it (issue #853).

```sh
nubx turbo build --filter='@storyshelf/app' --filter='storyshelf' --filter='@storyshelf/db-sqlite' --filter='@storyshelf/runner'
(cd fixtures/storybook-9 && pnpm install && pnpm run build-storybook)
nub run bench                      # warm-up run (dropped), then the median of 3
nub run bench -- --runs 5 --out .tmp/bench.json
```

It uploads the fixture with the built CLI three times (first, unchanged, one asset changed by a line) and reports. Every upload passes `--full`, so the `unchanged` row is a **full capture of an unchanged build** (every story renders again; the bench fails if it captures fewer snapshots than the first upload). That is the row ADR 0052's speed gate compares. The fixtures also hold deliberately leaking stories (`Leaks`, ADR 0052 decision 9), so the bench's story count includes them:

- **Storage:** bytes and objects after each upload and its capture, split into Storybook files (`content/`), per-build zips, screenshots and metadata.
- **Capture:** wall time from upload to a finished build, the orchestrator's `timed()` sums (`db`, `storage`, `capture.extract`, `capture.render`, `capture.persist`) and render time per screenshot. Navigation, settle, screenshot and diff are inside `capture.render`: nothing records them separately yet.

### The `schema-break` label

Until 2027-01-01 a contract step (drop, rename, `NOT NULL`, unique index, narrowing), a new job kind
or a new status value may ship in the release that needs it (ADR 0053 amendment, 2026-11-21). The
job above would fail on such a change by design, so a pull request labelled `schema-break` skips it.
The label is read when `ci.yml` runs (opened, new push), so add it before the push that needs it.
`scripts/changeset-check.mjs` then requires a changeset that starts with `Breaking:` and whose body
has a `Schema: <the contract step>` line (`Schema: none` does not count), so the release notes say
the upgrade is stop-the-world. Without the label the job runs as before and still catches accidental
breaks. The rule is tested in `scripts/changeset-lib.test.mjs` (`checkSchemaBreak`).

- **Database:** queries between the build turning `capturing` and the `capture timings` log, by method, with the slowest. `transact` counts as one call; the statements inside it are not counted.
- **Published serving:** storage calls (`exists`, `read`, `readStream`) and wall time to load `/_/<buildId>/` and one story's `iframe.html` in Chromium until the network is idle.
- **App pages:** response bytes and time for the project, build and component pages.

Runs compare when the machine, Node and Playwright versions match; quote them with the numbers. Concurrency is fixed in `scripts/bench/harness.mjs`. A manual `Bench` workflow (`workflow_dispatch`) uploads the JSON as an artifact; its numbers come from a shared runner, so compare them only with other runs of that workflow.

## File conventions

- **Unit:** colocated `*.test.ts` next to sources (hermetic — tmp dirs, fake adapters, mocked `fetch`; never a browser, network, or Storybook build).
- **HTTP-level integration:** `*.integration.test.ts` in the same dirs (real router over HTTP with fake capture runner; still hermetic and CI-always).
- **Real browser:** gated behind `RUN_INTEGRATION=1` (`nub run test:integration`, Playwright + `fixtures/storybook-8` by default).
- **Terraform modules:** the CLI no longer generates Terraform (`server init --cloud` writes a module stub, tested in `init/cloud.test.ts`). The modules under `deploy/terraform/` are checked by the deploy checks in CI (ADR 0050).
- **Real cloud:** `*.live.test.ts` next to sources, gated behind `LIVE_CLOUD=1` — strictly real providers, no fakes, no emulators. See "Live cloud tests" below.
- **Shared doubles** live in `packages/core/src/test-helpers/` (`fake-adapters.ts`, `create-project.ts`) — never in shippable modules. Test files (and `test-helpers/`) are exempt from size lint rules via `.oxlintrc.json` patterns, not per-file paths.

## Fixtures

- `fixtures/storybook-8` — SB 8.6 Vite React (default, 7 stories; own pnpm install, `6008`)
- `fixtures/storybook-9` — SB 9 Vite React (`6009`, no `addon-essentials`, `features: {backgrounds,controls,viewport}`)
- `fixtures/storybook-10` — SB 10 ESM + CSF-Next (`.test()` entries with `subtype:'test'`, run only with `runTests`; `6010`, `definePreview`/`preview.meta`/`meta.story` + `experimentalTestSyntax`)
- All fixtures are deterministic (system fonts, no network) and share the same `Button` stories (including `play`/`flaky-test`/`disableSnapshot`/`delay` variants). `storybook-static/` is built on demand, not committed.
- PNG fixtures for the diff engine.
- `index.json` fixtures for `discover()`.

## Dependency audit (#47)

`.github/workflows/audit.yml` runs weekly (Monday 06:17 UTC) and on demand (`workflow_dispatch`), one matrix leg per lockfile: `workspace` (`nub.lock`) and `storybook-8`, `storybook-9`, `storybook-10` (the fixtures' own pnpm lockfiles). It has `permissions: contents: read`, no secrets, and no other workflow depends on it, so a red run blocks no merge. It never upgrades, commits or publishes; a failing run is the notification.

`scripts/audit-check.mjs` does the work. `nub audit` reads only the root importer (182 of the lockfile's 1581 packages), so the workspace is audited as `pnpm audit` over a copy of `nub.lock` (pnpm's lockfile format) and the workspace manifests, staged in `.tmp/`; the fixtures run `pnpm audit` in place. It reports advisory ids, packages, versions and advisory links only. A leg fails when:

- an advisory is not a tracked exception for that target;
- an exception is past its `reviewBy` date;
- `scripts/audit-exceptions.json` is malformed, or an entry is missing from SECURITY.md, "Known advisories";
- the audit could not run (registry error, no report). The exit code of `pnpm audit` is not the signal, because it exits 1 whenever it finds anything.

An exception that matches nothing is a notice in the run summary; remove it once the fix is confirmed. The owner alone adds an exception or moves a date, with the reason in SECURITY.md and the tracking issue (#335).

Run it locally with `node scripts/audit-check.mjs` (all targets), `--target storybook-9` for one, and `--today YYYY-MM-DD` to check how an expiry behaves. Its tests (`scripts/audit-check.test.mjs`, `node --test`) run in the `ci.yml` lint step and need no network.

## Live cloud tests (gated: `LIVE_CLOUD=1`)

Strictly real providers — no injected fake clients, no emulators. Hermetic
`turbo test` never touches the network: live files `skipIf(LIVE_CLOUD !== "1")`
and construct adapters inside `beforeAll`, so skipped runs don't even read
cloud env vars. Live results must never come from the turbo cache — always
run with `--force`. Manual dispatch only, per provider (the nightly schedules
are deferred until secrets exist; see #410):

- `.github/workflows/live-cloud-aws.yml` — S3
- `.github/workflows/live-cloud-azure.yml` — Blob
- `.github/workflows/live-cloud-gcp.yml` — GCS
- `.github/workflows/live-cloud-ancillary.yml` — Turso + Postgres + MySQL + OAuth + GitHub + GitLab (matrix `db`/`auth`/`git`; long-lived resources, no scaffold)

The Terraform modules under `deploy/terraform/` are checked by the deploy checks in `ci.yml`
(`fmt`, `validate`, `tflint`). Each workflow's `module-apply` job applies the module's
`examples/minimal` (see the module README, "Checks"); it stays off until its repository variable
is `1`.

### Output → env map

| Target | Terraform output                 | Env / secret                           |
| ------ | -------------------------------- | -------------------------------------- |
| AWS    | `s3_bucket`                      | `SHELF_S3_BUCKET` (+ `AWS_REGION`)     |
| AWS    | `db_endpoint`                    | `DATABASE_URL` (`?sslmode=require`)    |
| AWS    | `user_pool_id` / `app_client_id` | `COGNITO_*` / `SHELF_OIDC_*` (phase 4) |
| Azure  | `storage_connection_string`      | `SHELF_AZURE_CONNECTION_STRING`        |
| Azure  | (container, pre-provisioned)     | `LIVE_AZURE_CONTAINER`                 |
| Azure  | `database_url`                   | `DATABASE_URL` (phase 4)               |
| GCP    | `gcs_bucket`                     | `LIVE_GCS_BUCKET`                      |
| GCP    | (project)                        | `GCP_PROJECT_ID`                       |
| GCP    | (service-account key JSON)       | `GCP_SERVICE_ACCOUNT_JSON`             |

AWS creds come from the standard SDK chain (`AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` or an IAM role). GCP creds come from ADC
(`GOOGLE_APPLICATION_CREDENTIALS` locally, `google-github-actions/auth`
in CI).

### Manual runbook (follow these steps later)

1. **Provision** (per target, one-time): `storyshelf server init --cloud
<aws|azure|gcp>` (or `deploy/terraform/<cloud>/examples/minimal`). The stub and `examples/minimal`
   output only `url` (and `service_name`). For the storage name in the table below, first add a
   root output that forwards the module's, such as
   `output "gcs_bucket" { value = module.storyshelf.gcs_bucket }` (GCP) or `s3_bucket` (AWS), so it
   is in the state the apply writes. Then, in that directory:
   ```sh
   terraform init
   terraform plan -var "name=shelf-manual-<name>" -out=tfplan  # review!
   terraform apply tfplan
   terraform output -json
   ```
   Use a personal `shelf-manual-<name>` prefix so parallel runs never share
   resources. Prefer serverless/cheap engines (AWS DSQL, Cloud SQL `f1-micro`).
2. **Map outputs to env** using the table above, plus credentials
   (`AWS_*`, `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json`).
3. **Run** (from the repo root, or per package):
   ```sh
   export PATH="$HOME/.nub/bin:$PATH"
   LIVE_CLOUD=1 SHELF_S3_BUCKET=... \
     nubx turbo test --filter='@storyshelf/storage' --force -- src/s3
   ```
   Per-package equivalent: `cd packages/storage && LIVE_CLOUD=1 SHELF_S3_BUCKET=... ./node_modules/.bin/vitest run src/s3` (`src/gcs`, `src/azure` for the others: each cloud runs only its own subpath).
4. **Teardown:** suites delete their own keys/messages (unique
   `live/<run-id>/<uuid>` prefixes, per-run build ids), but the
   infrastructure is yours — `terraform destroy -var
"name=shelf-manual-<name>" -auto-approve` when done.
5. **Costs:** live suites are a handful of API calls; the spend is idle
   infrastructure (RDS, Cloud SQL, Postgres Flexible Server). Destroy promptly.

### Phase 4 (ancillary: `.github/workflows/live-cloud-ancillary.yml`)

No terraform module covers these — resources are long-lived and shared,
isolation is per-run. Matrix legs: `db`, `auth`, `git` (nightly +
manual dispatch, `--force` so results never come from cache).

| Suite    | Resource to provision (one-time, manual)                                                                                      | Env                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Turso    | Turso database (`turso db create shelf-live-test`)                                                                            | `TURSO_DATABASE_URL` (`libsql://…`), `TURSO_AUTH_TOKEN`                                      |
| Postgres | Any wire-compatible DB (Neon/Supabase free tier is enough; use a direct connection, not the pooler)                           | `DATABASE_URL` (`?sslmode=require` for managed)                                              |
| OAuth    | OIDC app with a redirect URL (Auth0 free tenant; Keycloak/Entra/Okta/Cognito work too) — discovery-only, no interactive login | `SHELF_OIDC_ISSUER`, `SHELF_OIDC_CLIENT_ID`, `SHELF_OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URL` |
| GitHub   | Test repo + PAT with `repo:status`; reserve a throwaway SHA (statuses are immutable)                                          | `LIVE_GH_TOKEN`, `LIVE_GH_OWNER`, `LIVE_GH_REPO`, `LIVE_GH_SHA`                              |
| GitLab   | Test project + token with `api` scope; reserve a throwaway SHA                                                                | `LIVE_GL_TOKEN`, `LIVE_GL_OWNER`, `LIVE_GL_REPO`, `LIVE_GL_SHA`, optional `LIVE_GL_HOST`     |

Isolation: unique row ids/slugs (DBs, removed afterwards), unique status contexts (`storyshelf/live-<run-id>`).
Suites gate on their own env (`skipIf`), so a leg exercises exactly the
providers whose secrets are present; each leg fail-fasts when none of its
secrets are set. Local run example:

```sh
export PATH="$HOME/.nub/bin:$PATH"
LIVE_CLOUD=1 TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... \
  nubx turbo test --filter='@storyshelf/db-sqlite' --force
```

Database compatibility runs nightly and on demand in
`.github/workflows/nightly-db.yml`. It tests SQLite and local file-backed libSQL, plus PostgreSQL
16 and MySQL 8 services. This does not substitute for the cloud-provider tests above. The live MySQL suite's
upgrade test drops columns before rerunning migrations; it is skipped unless
`MYSQL_SCHEMA_MUTATION_TEST=1` is set. Set that flag only for a disposable database, never a
shared cloud database. The regular live suite still tests setup, CRUD and queue behavior.

The review-schema upgrade (#269) is tested on every dialect from fixture databases built from the
old DDL (`src/test-fixtures/pre-review.sql` and `pre-449.sql` in each `db-*` package): SQLite and
Postgres (PGlite) run hermetically, and MySQL has a hermetic fake-server test plus
`migrate-review.live.test.ts`, which needs the same flag and a user that may `CREATE DATABASE`
(it upgrades the fixtures in a scratch database it drops afterwards). Postgres has the same live
file, gated on `LIVE_CLOUD=1`, `DATABASE_URL` and `POSTGRES_SCHEMA_MUTATION_TEST=1` (a role that
may `CREATE DATABASE`; set the flag for a disposable server only). The MySQL live file also runs the
review lifecycle on a real server: one claimant wins a review cycle, a reopening counts once, a
build's verdicts go with the build and a user's with the user, and an anonymous verdict stays.

The MySQL job also runs the shared `databaseContractSuite` (`packages/db-mysql/src/contract.test.ts`),
as SQLite and Postgres do, in its own database. That file is skipped unless `MYSQL_URL` is set, so
`nub run test` stays hermetic. To run it yourself, against a disposable database:

```sh
docker run -d --name shelf-mysql -p 127.0.0.1:3306:3306 -e MYSQL_ROOT_PASSWORD=pw -e MYSQL_DATABASE=shelf mysql:8.0
# a fresh container needs a while to initialise: wait until it answers, for at most 60 s, and only then run the tests
timeout 60 sh -c 'until docker exec shelf-mysql mysqladmin ping -h 127.0.0.1 -ppw --silent; do sleep 1; done' \
  && MYSQL_URL=mysql://root:pw@127.0.0.1:3306/shelf nubx vitest run src/contract.test.ts   # from packages/db-mysql
```

Run vitest directly, as above. `nub run test` goes through turbo, whose strict environment mode does not
pass `MYSQL_URL` to the tests, so the suite would be skipped (the nightly job uses `--env-mode=loose`).

## Previous-release database job (ADR 0053, decision 8)

`previous-release-db` in `ci.yml` runs on pull requests that touch a schema or migration file, the
job queue, its consumer or an enqueue path (the `schema` output of the `changes` job), for SQLite
and Postgres. `scripts/previous-release.sh
<dialect>` installs the newest `v*` release from npm, migrates an empty database with it and
seeds a project, migrates the same database with the checkout as the next minor, then starts the
published release on it and smokes it (health, project list, a write, a read-back, the root page).
The release must skip its migrations and leave `schema_meta` alone. Postgres also runs the release's
own `postgres.live.test.ts` from a checkout of its tag.

Step 5 is the mixed-queue test. The checkout enqueues one job of every kind through its own enqueue
paths, a repository link's `notify` job at payload version 2 among them
(`scripts/previous-release/mixed-queue-current.ts`). The published release's own queues and
consumers then run alone for a while, as after a rollback (`mixed-queue-previous.mjs`; handlers
keep that release's declarations, and `run` only records). They must run every v1 job and hand
each newer payload back unrun with no attempt spent. Next they run beside the checkout's consumers
on a second batch, as during a rolling deploy. Every job must end `done`, run exactly once, and
each newer payload must run on the checkout. A kind added to `CaptureJobKind` and not enqueued
there fails the typecheck. To reproduce: `DATABASE_URL=… bash scripts/previous-release.sh postgres`
(`RUN_TAG_SUITES=0` skips step 4, `RUN_MIXED_QUEUE=0` step 5). MySQL (nightly) is not part of it
yet.
