# Testing Strategy

## Principles

- **Fast and hermetic by default.** `nub run test` (vitest) must never need a browser, network, or a Storybook build. Browser coverage is gated.
- **Constructor injection makes this possible.** Models take adapters in their constructor (ADR 0001), so unit tests pass in-memory SQLite (`:memory:`), a temp-dir storage, and fakes for capture/auth/status.
- **Assert behavior, not lines.** The 100%-coverage target (AGENTS.md) applies to models, routers, adapters, and the diff engine. The browser-integration path is asserted behaviorally.

## Layers

### 1. Unit (vitest, colocated `*.test.ts`, CI-always)

- **Models** — baseline resolution (per-branch fallback chain), accept/reject, purge candidate selection (terminal + TTL + keep-latest-per-branch + `persistent` exemption + orphan GC + branch GC via `purgeStaleBranches` TTL + default-branch exempt), labels (URL-safe values, latest-build resolution, `persistent` non-removable).
- **Diff engine** — committed fixture PNGs (identical, differing, size-changed) assert `diffPixels`/`diffRatio`/overlay bytes.
- **Routers/handlers** — Hono request/response against in-memory DB + fake storage; auth/role middleware with a mock `AuthAdapter`.
- **Capture `discover()` / `buildUrl()`** — parse a committed `index.json` fixture; URL-safety (encodeURI + wildcard value segment).
- **URL builder** — path vs subdomain forms, label/branch encoding.

### 2. Adapter contract tests

Each adapter against its interface: SQLite via `:memory:` (Turso via a local libSQL stub), storage-local via a temp dir, storage-s3 via a recorded/fake client, auth adapters with a mock provider.

### 3. Integration (vitest, CI-always)

`createShelfApp({ database, storage, capture: <fake> })` drives the full `upload → capture → diff → review → approve` flow over HTTP. Capture is a fake runner here (a real one needs a browser).

### 4. Browser integration (gated: `nub run test:integration`)

- **Visual (all fixtures, matrix in CI):** Runs the real capture pipeline (`@storyshelf/runner-playwright`) against a built Storybook fixture in `fixtures/storybook-8` (default, 7 stories), `fixtures/storybook-9`, and `fixtures/storybook-10` (each independent `pnpm` install, built on demand `pnpm install && pnpm run build-storybook`; `storybook-static/` is `.gitignored`). Override locally with `FIXTURE_DIR=fixtures/storybook-9`. Requires Playwright browsers (one-time provision: `npx -y playwright@1.63.0 install chromium`). Gated so `turbo test` stays browser-free.
- **Interaction (`play`, only oldest):** When a project has `executePlay: true`, the same suite runs `play` functions before screenshots. Tested only against `fixtures/storybook-8` (oldest) unless a major changes the `play` channel — then add a single `play` smoke for that major. Verified: `BlockingFailure` → whole build `failed`, `FlakyTag`/`FlakyParam` (`flaky-test`) → non-blocking `reviewing` with warning, `Disabled` (`skip`/`disableSnapshot`) → not counted.

## File conventions

- **Unit:** colocated `*.test.ts` next to sources (hermetic — tmp dirs, fake adapters, mocked `fetch`; never a browser, network, or Storybook build).
- **HTTP-level integration:** `*.integration.test.ts` in the same dirs (real router over HTTP with fake capture runner; still hermetic and CI-always).
- **Real browser:** gated behind `RUN_INTEGRATION=1` (`nub run test:integration`, Playwright + `fixtures/storybook-8` by default).
- **Real cloud:** `*.live.test.ts` next to sources, gated behind `LIVE_CLOUD=1` — strictly real providers, no fakes, no emulators. See "Live cloud tests" below.
- **Shared doubles** live in `packages/core/src/test-helpers/` (`fake-adapters.ts`, `create-project.ts`) — never in shippable modules. Test files (and `test-helpers/`) are exempt from size lint rules via `.oxlintrc.json` patterns, not per-file paths.

## Fixtures

- `fixtures/storybook-8` — SB 8.6 Vite React (default, 7 stories; own pnpm install, `6008`)
- `fixtures/storybook-9` — SB 9 Vite React (`6009`, no `addon-essentials`, `features: {backgrounds,controls,viewport}`)
- `fixtures/storybook-10` — SB 10 ESM + CSF-Next (filters `subtype:'test'`, `6010`, `definePreview`/`preview.meta`/`meta.story` + `experimentalTestSyntax`)
- All fixtures are deterministic (system fonts, no network) and share the same `Button` stories (including `play`/`flaky-test`/`disableSnapshot`/`delay` variants). `storybook-static/` is built on demand, not committed.
- PNG fixtures for the diff engine.
- `index.json` fixtures for `discover()`.

## Live cloud tests (gated: `LIVE_CLOUD=1`)

Strictly real providers — no injected fake clients, no emulators (Service Bus
and Pub/Sub have no local emulators in this harness by design). Hermetic
`turbo test` never touches the network: live files `skipIf(LIVE_CLOUD !== "1")`
and construct adapters inside `beforeAll`, so skipped runs don't even read
cloud env vars. Live results must never come from the turbo cache — always
run with `--force`. Nightly + manual dispatch per provider:

- `.github/workflows/live-cloud-aws.yml` — S3 + SQS
- `.github/workflows/live-cloud-azure.yml` — Blob + Storage Queues + Service Bus (matrix)
- `.github/workflows/live-cloud-gcp.yml` — GCS + Pub/Sub
- `.github/workflows/live-cloud-ancillary.yml` — Turso + Postgres + Redis + OAuth + GitHub + GitLab (matrix `db`/`queue`/`auth`/`git`; long-lived resources, no scaffold)

Each workflow also validates its terraform scaffold generator (`fmt` +
`init -backend=false` + `validate`, mirroring the CLI's
`terraform-*.integration.test.ts`). Scaffold output keys are a frozen
contract pinned by `terraform-*.test.ts` — renames break CI.

### Output → env map

| Target | Terraform output | Env / secret |
|---|---|---|
| AWS | `s3_bucket` | `S3_BUCKET` (+ `AWS_REGION`) |
| AWS | `queue_url` | `QUEUE_URL` |
| AWS | `db_endpoint` | `DATABASE_URL` (`?sslmode=require`) |
| AWS | `user_pool_id` / `app_client_id` | `COGNITO_*` / `OIDC_*` (phase 4) |
| Azure | `storage_connection_string` | `AZURE_STORAGE_CONNECTION` |
| Azure | `servicebus_connection_string` | `AZURE_SERVICE_BUS_CONNECTION` |
| Azure | `queue_name` (`capture-jobs`) | `LIVE_AZURE_QUEUE` |
| Azure | (container, pre-provisioned) | `LIVE_AZURE_CONTAINER` |
| Azure | `database_url` | `DATABASE_URL` (phase 4) |
| GCP | `gcs_bucket` | `LIVE_GCS_BUCKET` |
| GCP | `pubsub_topic` / `pubsub_subscription` | `LIVE_PUBSUB_TOPIC` / `LIVE_PUBSUB_SUBSCRIPTION` |
| GCP | (project) | `GCP_PROJECT_ID` |
| GCP | (service-account key JSON) | `GCP_SERVICE_ACCOUNT_JSON` |

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
   LIVE_CLOUD=1 S3_BUCKET=... QUEUE_URL=... \
     nubx turbo test --filter='@storyshelf/storage-s3' --filter='@storyshelf/queue-sqs' --force
   ```
   Per-package equivalent: `cd packages/storage-s3 && LIVE_CLOUD=1 S3_BUCKET=... ./node_modules/.bin/vitest run`.
4. **Teardown:** suites delete their own keys/messages (unique
   `live/<run-id>/<uuid>` prefixes, per-run build ids), but the
   infrastructure is yours — `terraform destroy -var
   "project=shelf-manual-<name>" -auto-approve` when done.
5. **Costs:** live suites are a handful of API calls; the spend is idle
   infrastructure (RDS, Cloud SQL, Service Bus namespace). Destroy promptly.

### Phase 4 (ancillary: `.github/workflows/live-cloud-ancillary.yml`)

No terraform scaffold covers these — resources are long-lived and shared,
isolation is per-run. Matrix legs: `db`, `queue`, `auth`, `git` (nightly +
manual dispatch, `--force` so results never come from cache).

| Suite | Resource to provision (one-time, manual) | Env |
|---|---|---|
| Turso | Turso database (`turso db create shelf-live-test`) | `TURSO_DATABASE_URL` (`libsql://…`), `TURSO_AUTH_TOKEN` |
| Postgres | Any wire-compatible DB (Neon/Supabase free tier is enough; use a direct connection, not the pooler) | `DATABASE_URL` (`?sslmode=require` for managed) |
| Redis | Upstash/ElastiCache/Memorystore (or local `redis://localhost:6379` for a smoke run) | `REDIS_URL` |
| OAuth | OIDC app with a redirect URL (Auth0 free tenant; Keycloak/Entra/Okta/Cognito work too) — discovery-only, no interactive login | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URL` |
| GitHub | Test repo + PAT with `repo:status`; reserve a throwaway SHA (statuses are immutable) | `LIVE_GH_TOKEN`, `LIVE_GH_OWNER`, `LIVE_GH_REPO`, `LIVE_GH_SHA` |
| GitLab | Test project + token with `api` scope; reserve a throwaway SHA | `LIVE_GL_TOKEN`, `LIVE_GL_OWNER`, `LIVE_GL_REPO`, `LIVE_GL_SHA`, optional `LIVE_GL_HOST` |

Isolation: unique row ids/slugs (DBs, removed afterwards), unique Redis
keys (`shelf:live:<run>:<uuid>` — `{key}`, `{key}:processing`,
`{key}:delayed`), unique status contexts (`storyshelf/live-<run-id>`).
Suites gate on their own env (`skipIf`), so a leg exercises exactly the
providers whose secrets are present; each leg fail-fasts when none of its
secrets are set. Local run example:

```sh
export PATH="$HOME/.nub/bin:$PATH"
LIVE_CLOUD=1 TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... \
  nubx turbo test --filter='@storyshelf/db-turso' --force
```
