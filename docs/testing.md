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
- **Push to `main`:** full, uncached `turbo verify --filter='!website' --force`.
- **Nightly:** the same full uncached verify plus `turbo run test:flake`, every Storybook fixture, and the Fly dry run. It is the backstop for anything `--affected` could miss.
- File-level `vitest --changed` is deliberately not a required gate: dynamic imports and cross-package resolution can miss a test. Use it only as an advisory experiment, with the nightly full run as the safety net.

## Layers

### 1. Unit (vitest, colocated `*.test.ts`, CI-always)

- **Models** — baseline resolution (per-branch fallback chain), accept/reject, purge candidate selection (terminal + TTL + keep-latest-per-branch + `persistent` exemption + orphan GC + branch GC via `purgeStaleBranches` TTL + default-branch exempt), labels (URL-safe values, latest-build resolution, `persistent` non-removable).
- **Diff engine** — committed fixture PNGs (identical, differing, size-changed) assert `diffPixels`/`diffRatio`/overlay bytes.
- **Routers/handlers** — Hono request/response against in-memory DB + fake storage; auth/role middleware with a stub `Auth`.
- **Capture `discover()` / `buildUrl()`** — parse a committed `index.json` fixture; URL-safety (encodeURI + wildcard value segment).
- **URL builder** — path vs subdomain forms, label/branch encoding.

### 2. Adapter contract tests

Each adapter against its interface: SQLite via `:memory:` (Turso via a local libSQL stub), storage-local via a temp dir, storage-s3 via a recorded/fake client, auth via the engine adapter over `:memory:` SQLite.

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

| Requirement                                   | Storage (`storage-*`)                                                                                    | DB (`db-*`)                                                | Runner / git / auth / notify                               |
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
- Core validates untrusted input at the boundary: storage path segments
  (`paths.ts`), screenshot bytes (`capture/guards.ts`: PNG magic + 25 MiB cap),
  list limits (`clampListLimit`, max 1000).
- Idempotency is asserted, not assumed: run `setup`, `teardown`, `migrate`,
  and `enqueue`-retry twice.
- Indirect coverage allowed only for pure mappers (e.g. `notify-git`
  `github-mapper.ts` precedent); everything else has a direct colocated suite.

### 3. Integration (vitest, CI-always)

`createShelfApp({ database, storage, testing: { runner: <fake> } })` drives the full `upload → capture → diff → review → approve` flow over HTTP. Capture is a fake runner here (a real one needs a browser).

### 4. Browser integration (gated: `nub run test:integration`)

- **Visual (all fixtures, matrix in CI):** Runs the real capture pipeline (`@storyshelf/runner-playwright`) against a built Storybook fixture in `fixtures/storybook-8` (default, 7 stories), `fixtures/storybook-9`, and `fixtures/storybook-10` (each independent `pnpm` install, built on demand `pnpm install && pnpm run build-storybook`; `storybook-static/` is `.gitignored`). Override locally with `FIXTURE_DIR=fixtures/storybook-9`. Requires Playwright browsers (one-time provision: `npx -y playwright@1.63.0 install chromium`). Gated so `turbo test` stays browser-free.
- **Interaction (`play`, only oldest):** When a project has `executePlay: true`, the same suite runs `play` functions before screenshots. Tested only against `fixtures/storybook-8` (oldest) unless a major changes the `play` channel — then add a single `play` smoke for that major. Verified: `BlockingFailure` → whole build `failed`, `FlakyTag`/`FlakyParam` (`flaky-test`) → non-blocking `reviewing` with warning, `Disabled` (`skip`/`disableSnapshot`) → not counted.

- **Settled signalling and `.test()` runs (`settle.integration.test.ts` in both runners):** on any fixture, a render waits for Storybook's own event (no fallback warning, identical re-captures, the play error of a flaky story is reported), falls back to the fixed wait on a page with no channel (immediately) and on a silent channel (after the 5 s timeout), and `runTests` reports pass or fail per `.test()` entry. Only `fixtures/storybook-10` has test entries (`renders its label` and `clicks without error` pass, `fails on purpose` fails; written as bare `Primary.test(...)` statements, because the indexer ignores an exported call), so the Playwright suite also runs a build with `runTests` on (the failing test fails the build, results are stored, no snapshot is taken for a test) and one with it off (nothing stored). On Storybook 8 and 9 the same tests assert the no-op. The failing test needs no tag: it is inert unless a project turns `runTests` on, which only these tests do. Puppeteer: set `PUPPETEER_EXECUTABLE_PATH`.

## File conventions

- **Unit:** colocated `*.test.ts` next to sources (hermetic — tmp dirs, fake adapters, mocked `fetch`; never a browser, network, or Storybook build).
- **HTTP-level integration:** `*.integration.test.ts` in the same dirs (real router over HTTP with fake capture runner; still hermetic and CI-always).
- **Real browser:** gated behind `RUN_INTEGRATION=1` (`nub run test:integration`, Playwright + `fixtures/storybook-8` by default).
- **Real cloud:** `*.live.test.ts` next to sources, gated behind `LIVE_CLOUD=1` — strictly real providers, no fakes, no emulators. See "Live cloud tests" below.
- **Shared doubles** live in `packages/core/src/test-helpers/` (`fake-adapters.ts`, `create-project.ts`) — never in shippable modules. Test files (and `test-helpers/`) are exempt from size lint rules via `.oxlintrc.json` patterns, not per-file paths.

## Fixtures

- `fixtures/storybook-8` — SB 8.6 Vite React (default, 7 stories; own pnpm install, `6008`)
- `fixtures/storybook-9` — SB 9 Vite React (`6009`, no `addon-essentials`, `features: {backgrounds,controls,viewport}`)
- `fixtures/storybook-10` — SB 10 ESM + CSF-Next (`.test()` entries with `subtype:'test'`, run only with `runTests`; `6010`, `definePreview`/`preview.meta`/`meta.story` + `experimentalTestSyntax`)
- All fixtures are deterministic (system fonts, no network) and share the same `Button` stories (including `play`/`flaky-test`/`disableSnapshot`/`delay` variants). `storybook-static/` is built on demand, not committed.
- PNG fixtures for the diff engine.
- `index.json` fixtures for `discover()`.

## Live cloud tests (gated: `LIVE_CLOUD=1`)

Strictly real providers — no injected fake clients, no emulators. Hermetic
`turbo test` never touches the network: live files `skipIf(LIVE_CLOUD !== "1")`
and construct adapters inside `beforeAll`, so skipped runs don't even read
cloud env vars. Live results must never come from the turbo cache — always
run with `--force`. Nightly + manual dispatch per provider:

- `.github/workflows/live-cloud-aws.yml` — S3
- `.github/workflows/live-cloud-azure.yml` — Blob
- `.github/workflows/live-cloud-gcp.yml` — GCS
- `.github/workflows/live-cloud-ancillary.yml` — Turso + Postgres + MySQL + OAuth + GitHub + GitLab (matrix `db`/`auth`/`git`; long-lived resources, no scaffold)

Each workflow also validates its terraform scaffold generator (`fmt` +
`init -backend=false` + `validate`, mirroring the CLI's
`terraform-*.integration.test.ts`). Scaffold output keys are a frozen
contract pinned by `terraform-*.test.ts` — renames break CI.

### Output → env map

| Target | Terraform output                 | Env / secret                        |
| ------ | -------------------------------- | ----------------------------------- |
| AWS    | `s3_bucket`                      | `S3_BUCKET` (+ `AWS_REGION`)        |
| AWS    | `db_endpoint`                    | `DATABASE_URL` (`?sslmode=require`) |
| AWS    | `user_pool_id` / `app_client_id` | `COGNITO_*` / `OIDC_*` (phase 4)    |
| Azure  | `storage_connection_string`      | `AZURE_STORAGE_CONNECTION`          |
| Azure  | (container, pre-provisioned)     | `LIVE_AZURE_CONTAINER`              |
| Azure  | `database_url`                   | `DATABASE_URL` (phase 4)            |
| GCP    | `gcs_bucket`                     | `LIVE_GCS_BUCKET`                   |
| GCP    | (project)                        | `GCP_PROJECT_ID`                    |
| GCP    | (service-account key JSON)       | `GCP_SERVICE_ACCOUNT_JSON`          |

AWS creds come from the standard SDK chain (`AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` or an IAM role). GCP creds come from ADC
(`GOOGLE_APPLICATION_CREDENTIALS` locally, `google-github-actions/auth`
in CI).

### Manual runbook (follow these steps later)

1. **Provision** (per target, one-time): `storyshelf server init --target
<aws|azure|gcp>`, then under the generated `terraform/`:
   ```sh
   terraform init
   terraform plan -var "project=shelf-manual-<name>" -out=tfplan  # review!
   terraform apply tfplan
   terraform output -json   # or: npm run infra:outputs
   ```
   Use a personal `shelf-manual-<name>` prefix so parallel runs never share
   resources. Prefer serverless/cheap engines (AWS DSQL, Cloud SQL `f1-micro`).
2. **Map outputs to env** using the table above, plus credentials
   (`AWS_*`, `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json`).
3. **Run** (from the repo root, or per package):
   ```sh
   export PATH="$HOME/.nub/bin:$PATH"
   LIVE_CLOUD=1 S3_BUCKET=... \
     nubx turbo test --filter='@storyshelf/storage-s3' --force
   ```
   Per-package equivalent: `cd packages/storage-s3 && LIVE_CLOUD=1 S3_BUCKET=... ./node_modules/.bin/vitest run`.
4. **Teardown:** suites delete their own keys/messages (unique
   `live/<run-id>/<uuid>` prefixes, per-run build ids), but the
   infrastructure is yours — `terraform destroy -var
"project=shelf-manual-<name>" -auto-approve` when done.
5. **Costs:** live suites are a handful of API calls; the spend is idle
   infrastructure (RDS, Cloud SQL, Postgres Flexible Server). Destroy promptly.

### Phase 4 (ancillary: `.github/workflows/live-cloud-ancillary.yml`)

No terraform scaffold covers these — resources are long-lived and shared,
isolation is per-run. Matrix legs: `db`, `auth`, `git` (nightly +
manual dispatch, `--force` so results never come from cache).

| Suite    | Resource to provision (one-time, manual)                                                                                      | Env                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Turso    | Turso database (`turso db create shelf-live-test`)                                                                            | `TURSO_DATABASE_URL` (`libsql://…`), `TURSO_AUTH_TOKEN`                                  |
| Postgres | Any wire-compatible DB (Neon/Supabase free tier is enough; use a direct connection, not the pooler)                           | `DATABASE_URL` (`?sslmode=require` for managed)                                          |
| OAuth    | OIDC app with a redirect URL (Auth0 free tenant; Keycloak/Entra/Okta/Cognito work too) — discovery-only, no interactive login | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URL`               |
| GitHub   | Test repo + PAT with `repo:status`; reserve a throwaway SHA (statuses are immutable)                                          | `LIVE_GH_TOKEN`, `LIVE_GH_OWNER`, `LIVE_GH_REPO`, `LIVE_GH_SHA`                          |
| GitLab   | Test project + token with `api` scope; reserve a throwaway SHA                                                                | `LIVE_GL_TOKEN`, `LIVE_GL_OWNER`, `LIVE_GL_REPO`, `LIVE_GL_SHA`, optional `LIVE_GL_HOST` |

Isolation: unique row ids/slugs (DBs, removed afterwards), unique status contexts (`storyshelf/live-<run-id>`).
Suites gate on their own env (`skipIf`), so a leg exercises exactly the
providers whose secrets are present; each leg fail-fasts when none of its
secrets are set. Local run example:

```sh
export PATH="$HOME/.nub/bin:$PATH"
LIVE_CLOUD=1 TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... \
  nubx turbo test --filter='@storyshelf/db-sqlite' --force
```
