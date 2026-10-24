# ADR 0016: AI Insights

## Status

Accepted

Supersedes (archived): ADR 0026

## Context

StoryShelf captures everything an LLM needs for useful project insight: builds, snapshots with diff
ratios, baseline freshness, play-failure logs, a11y violations, affected changed files, comments and
cross-build history. Agent-consumable, validated UI context is where visual-testing products compete.

AI is a feature area; insights (build triage and project health) is the first feature in it. The package
is named `ai` (`@storyshelf/ai`) so later features (summaries, fix suggestions, agent tools) arrive
without new packages or contract rewrites.

Constraints: single prod owner per third-party dependency; the `core` root barrel stays domain-only and
never pulls SDK weight; outbound discipline per ADR 0001 (Architecture and Conventions); one-concern
modules with colocated tests; advisory-only verdicts (an AI result never approves, waives or merges);
a three-dialect schema (SQLite, Postgres, MySQL) that favours flat columns over JSON.

## Decision

### 1. `@storyshelf/ai` owns the `ai` SDK core only, never provider packages

Exactly one package lists `ai` (Vercel AI SDK), pinned exactly with no range, together with its
telemetry bridge `@ai-sdk/otel` (also pinned exactly). Bumps are deliberate and re-run the smoke check:
structured output through `generateText` with `Output.object()` and the repo's zod, plus multimodal
parts. Model-callable tools are not used. Provider packages (`@ai-sdk/openai`, `@ai-sdk/anthropic`,
Ollama) are installed by the deployer in server assembly and passed in as configured `LanguageModel`
instances. The package holds no keys, base URLs or provider code, so a new backend (Bedrock, Azure, a
local server) needs no change here.

**Credentials** never enter `@storyshelf/ai`; they live in the deployer's assembly inside the provider's
model instance. Supported routes: cloud-provider identity (Bedrock, Vertex, Azure OpenAI through IAM,
workload identity or managed identity, preferred for enterprises), vendor API keys held as service
secrets, an internal LLM gateway, or a local server (Ollama). Consumer or seat-plan credentials (Claude
subscription OAuth tokens, "Sign in with ChatGPT" tokens) are unsupported by design: they are issued for
the vendors' own clients, are seat-metered, and would tie a shared server to one person's refresh token.
Community providers that shell out to those CLIs are not documented or tested. Operator docs warn that
free tiers may log or train on prompts and screenshots, so they suit test data only.

Rejected: TanStack AI (client-oriented, immature for server structured output), raw `httpJson` to
provider REST (re-owns envelopes, schema repair and multimodal parts), and the SDK inside `core`. The
SDK's internal fetch is the domain-SDK exception to the shared HTTP helper; timeout and retry
ownership sit at this package's seam and are mandatory test surface.

### 2. `ShelfOptions.ai: Ai`: a singleton surface, not an adapter

`core/ai.ts` defines the `Ai` contract, a singleton like `Auth` (ADR 0011 Authentication and Access):
one per shelf, no swappable implementations, so adapter categories, adapter metadata and the snapshot
schema are untouched. Core owns the interface so `ShelfOptions.ai` needs no dependency edge into
`@storyshelf/ai`, which implements and re-exports it. Surface: `summarize({ profile?, task, system,
evidence, schema })` (`task` is `"triage" | "health"`, `schema` a zod schema, the result envelope schema
in core), `profileNames()`, `defaultProfile()`, `hasVision(profile?, task)`, `modelId(profile?, task)`,
`budget()`, `limits()`, `timeoutMs(profile?, task)`, optional `setLogger`, and `setup()`, `health()`,
`teardown()` (free checks only). Pure task routing, versioned prompts (pinned and logged) and the
deterministic evidence builders live in `core/insights` (the `@storyshelf/core/insights` and
`@storyshelf/core/ai` subpaths), with no HTTP and no SDK.

`ShelfOptions.ai` is wired like `auth`. Set means AI is on site-wide; absent means off (`501
ai-disabled`, UI inert). There is no `ShelfConfig` for AI: caps live in the `createAi` options beside
the models they govern, and the per-project choice is one column (decision 4). The only export is
`createAi` plus types; profile-name safety comes from a `const` generic (`defaultProfile?: NoInfer<P>`,
a closed task-key union, `null` only on `vision`), so misconfiguration is a compile error.

**Insights need `testing`.** Insight routes, panels and the AI thumbnails read snapshots, so they are
class `testing` (ADR 0006), 404 without `testing`, and also require `ai`. With `testing` off no
snapshots exist to triage and the insight surfaces are off.

### 3. One call shape: `profiles`, `ModelSlot` shorthand, instance-level budget

```ts
createAi({
  profiles: {
    default: { defaultModel: ollama("qwen2.5:14b") },
    thorough: {
      defaultModel: openai("gpt-4o-mini"),
      models: { vision: anthropic("claude-sonnet-4-5") },
    },
  },
  defaultProfile: "default", // optional: "default" key if present, else first key
  budget: { dailyTokens: 2_000_000, visionWeight: 5, perProjectCallsPerHour: 50 }, // optional
});
```

- `type ModelSlot = LanguageModel | { model: LanguageModel; maxTokens?: number; vision?: boolean;
timeoutMs?: number; providerOptions?: ProviderOptions }`. A bare instance takes task defaults (triage
  about 1500 tokens, health about 4000); the object form overrides. Slot keys are closed:
  `{ triage?, vision?, health? }`. `triage` and `health` are the two tasks; `vision` is a modality slot
  used by `triage` when images are sent. An omitted slot falls back to the profile's `defaultModel`.
- **Timeouts and retries.** The SDK's `maxRetries` is `0` (no hidden retries doubling spend); the seam
  owns the single schema-repair retry. Per-slot `timeoutMs` (defaults: triage 60 s, health 180 s) is
  enforced with `AbortSignal` and configurable for slow local models. A timed-out call is `failed`, and
  any usage it reported is recorded.
- `providerOptions` is an opaque pass-through to the SDK's per-call provider settings (reasoning effort
  or thinking budget, gateway routing and data policies); it adds no provider code here. The `vision`
  slot is used only when images are actually sent, and `Ai.modelId` and `timeoutMs` take `withImages` so
  cache hashes name the model that ran.
- **Effective vision** (pure, tested): an explicit `vision` flag beats placement; a bare model in the
  `vision` slot is assumed vision-capable; a model inherited from the default requires declared
  `vision: true`; an undeclared bare default is conservatively non-vision. A provider rejection falls
  back to text with a `visionSkipped` marker. `setup` runs only free checks (each model's
  `specificationVersion` against what the pinned `ai` supports, provider reachability where cheap);
  vision capability cannot be verified without a billed call and is not.
- **Budget** is instance-level: one shared pool, daily window is the UTC day. `visionWeight` multiplies
  the tokens counted for any call that sent images (providers under-report image cost). At 100% new
  calls get `429` until the next UTC day while cache hits are still served. Usage is provider-reported
  and persisted per row with `{ profile, task, model }` (a char/4 estimate flagged `estimated` when the
  backend reports nothing). The daily total is summed from those rows in the database, so the cap holds
  across all app instances with no in-memory counter. Pre-flight global and per-project checks return
  `429` with `Retry-After`. Calls that fail after the provider reported usage record a `failed` usage row
  and count toward the budget; calls reporting no usage count nothing. Checks are not atomic, and small
  concurrent overspend is accepted. When the daily total first crosses 50%, 75%, 90% and 100% of
  `dailyTokens`, site admins receive a `sys:ai-budget` system notification (ADR 0014 Git Hosts and
  Notifications), once per threshold per day, deduplicated by a marker row so concurrent instances do not
  double-send. Omitted `budget` means no daily cap, with the hourly abuse guard on.

### 4. Project gate: one column, tri-state, privacy through profiles

```sql
ai_profile TEXT NULL   -- NULL = off; 'default' = default profile; else a named profile
                       -- ('' rejected; unknown name => effective default plus a warning badge)
```

Site admins set it, through the project settings UI and the project PATCH API; project admins see it
read-only. It is the data-flow decision: a team that must keep data local gets a local, text-only
profile, another a cloud-vision profile. There are no separate `ai_enabled` or `ai_allow_images` flags.
No `orgs` entity is introduced.

### 5. Insights: triage and health, multimodal, advisory-only

Both scopes run over a shared pipeline with deterministic evidence limits (defaults, overridable in
`createAi` options):

- **Thumbnails:** at most 3 per call, ranked by diff ratio then failure status; 512 px long edge, kept
  as PNG and downscaled with the existing `pngjs` (no new image dependency). The manifest notes "N more
  omitted".
- **Logs:** play and a11y logs keep the first 2 KB and last 2 KB per failing snapshot with a "truncated N
  bytes" marker; total text evidence is capped near 24 KB with a fixed field order so the cut is
  deterministic.
- **Snapshot rows:** at most 50 changed snapshots by diff ratio; the rest are aggregated as counts.
- **Redaction** (`core/insights/redact.ts`, fixture-tested) runs before truncation and does not count
  toward the caps: secret-like keys, `Bearer`/`Basic` credentials, URLs with userinfo, JWTs, common key
  prefixes (`sk-`, `ghp_`, `AKIA`, `xox`) and long base64/hex runs. Unmatched content is not assumed
  safe; evidence excludes environment dumps and request headers by construction.
- **Result envelope** (zod, in core): `{ verdict: "likely-intended" | "needs-review" |
"likely-regression", summary, items: { snapshotKey, note, severity }[], confidence: "low" | "medium" |
"high" }`; health adds `{ score, trends[] }`. It is stored as an opaque validated text column, never
  queried.
- The evidence builder is pure: it receives already-loaded inputs (rows, log text, PNG buffers), and the
  handler layer loads them from the database and storage.
- **`inputHash`** covers the final assembled evidence plus prompt version, task, profile and model: a
  model or prompt change regenerates, identical evidence is a free cache hit.

Build insights are cached in an `insights` table and purged with their build. Project-health rows have
no build, so retention is time-based: one row per project and window, replaced on regeneration, deleted
by the purge job after 90 days or when the project is archived or deleted. Build-linked rows are deleted
explicitly in `core/retention/purge.ts` with their build, with no reliance on dialect foreign-key
cascade. Verdicts never approve, waive play failures or override `409 baseline_changed`. The
`insight:ready` (project topic) and `sys:ai-budget` (admin topic) events join the notification catalog
(ADR 0014), opt-in with the same fan-out.

### 6. API: first-class `/api/v1`, no new auth machinery

Routes follow `/api/v1/projects/{slug}/...`. They are `app.openapi` routes with schema entries, so they
appear in `openapi.json` for the docs and type-safe clients. There is no DELETE (rows die with builds
through retention) and no SSE: a cache hit returns 200, otherwise 202 plus polling, matching the upload
pattern.

| Method | Route                                               | Roles               | Behaviour                                                                                                                                                                                                                                                                                                                                                                       |
| ------ | --------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/projects/{slug}/builds/{buildId}/insights/latest` | `VIEW_ROLES`        | Cached triage; `404 never-generated` with a creation hint; while a run exists the response carries `status` (`pending`, `running`, `failed`, `done`) and, on `failed`, a bounded error code                                                                                                                                                                                     |
| `GET`  | `/projects/{slug}/builds/{buildId}/insights`        | `VIEW_ROLES`        | Bounded history list (`?limit`)                                                                                                                                                                                                                                                                                                                                                 |
| `POST` | `/projects/{slug}/builds/{buildId}/insights`        | `approver`, `admin` | `{ task?, force?, profile? }`: an `inputHash` hit returns 200 unbilled (`force` bypasses the cache and is billed); otherwise budget pre-check (429 plus `Retry-After`), then 202 with `Location`. `profile` is honoured for site admins only; for everyone else the project's `ai_profile` applies, so an approver cannot route data to a profile the site admin did not choose |
| `GET`  | `/projects/{slug}/insights/health?window=30d`       | `VIEW_ROLES`        | Cached digest; `404` plus a refresh hint                                                                                                                                                                                                                                                                                                                                        |
| `POST` | `/projects/{slug}/insights/health`                  | `approver`, `admin` | `{ window? }`: 202 on-demand run (no scheduler)                                                                                                                                                                                                                                                                                                                                 |

Roles are exact-match lists, not a hierarchy. Regeneration uses `APPROVER_ROLES` because it spends shared
budget and shapes review; developers only read. Session and Bearer paths share the existing role
resolution (ownerless legacy tokens act as viewer, cross-project tokens get a scoped 404, site-admin
bypass unchanged). Guard order: `ai` not configured gives `501 ai-disabled`; `ai_profile IS NULL` gives
`409 ai-disabled-for-project`; then role; then budget; then an in-memory rate-limit bucket as a coarse
per-instance abuse guard. The authoritative hourly and daily limits are counted from usage rows in the
database, so they hold across instances. Fallbacks are envelope fields (`profileRequested`,
`profileEffective`, `warnings[]`, `visionSkipped`, `usage.estimated`), never prose.

### 7. Layout

`packages/ai/src/` is stateless inference: `types.ts` (options and slots), `client.ts` (slot resolution,
effective-vision rules, validation), `codec.ts` (evidence to messages, `generateText` with
`Output.object()` and one schema-repair retry, usage mapping), `operations.ts` (`summarize`: profile
fallback, vision fallback, timeout, span), `state.ts`, `telemetry.ts` (registration and a local
`withSpan`), `metrics.ts`, `lifecycle.ts`, and `index.ts` (`createAi` first, re-exports at the bottom).
The exports map is frozen at `"."`.

Database-dependent parts live outside the package: pure evidence, redaction, hash and budget math in
`core/insights`; `InsightModel`, `AiUsageModel` and `AiBudgetAlertModel` in `core/models`; and the
DB-backed budget guard, evidence loaders, request orchestration and background jobs in
`packages/app/src/insights/`. The `Ai` contract is the seam, so `@storyshelf/ai` never imports the
database.

### 8. Observability

AI SDK 7 collects spans in `@ai-sdk/otel`: nothing is emitted until an integration is registered, and
once registered telemetry is opt-out (every call emits, recording inputs and outputs by default).
`@storyshelf/ai` therefore depends on `@opentelemetry/api` and `@ai-sdk/otel`, never on
`@storyshelf/observability` (the no-cycle rule of ADR 0015 applies, so its `withSpan` helper is an
intentional copy). The existing `initObservabilityFromEnv()` and `otelLogMixin` preamble covers the
tracer provider. `lifecycle.setup()` registers the `OpenTelemetry` integration once, idempotently, only
when OTEL is enabled by the host (`createAi({ otel })`, defaulting to on when
`OTEL_EXPORTER_OTLP_ENDPOINT` is set or `OTEL_DENO=true`); with OTEL off nothing is registered.

- Spans: one `ai.summarize` root per call (nested under the request's `http.server` span for on-demand
  triage, a fresh root per on-demand health run). The inference call is not wrapped in a span of its
  own: the SDK emits GenAI semantic-convention spans (`invoke_agent {model}`, `chat {model}`, with
  `gen_ai.usage.*`) nested under `ai.summarize`. Fallback markers are events on the root. Attributes are
  only `ai.task`, `ai.profile` (bounded, admin-configured names) and `ai.model`; never prompts,
  screenshots, story or build IDs, or secrets.
- Metrics (bounded cardinality): `ai.summarize.duration` and `ai.summarize.tokens` histograms
  (attribute `ai.task` plus outcome only), `ai.insights.completed` and `ai.insights.failed` counters
  (attribute `ai.task`). No per-story, per-build or per-profile series.
- Logs go through the host-owned logger and the existing mixin; log task, profile, model, outcome and
  usage, never evidence.
- Because SDK telemetry is opt-out once registered, every SDK call from `codec.ts` passes an explicit
  `telemetry: { functionId: "storyshelf-{task}", recordInputs: false, recordOutputs: false }` (never
  `isEnabled: true`, never runtime or tools context). Screenshots and prompts must never enter the trace
  backend. A test with the in-memory exporter asserts that no prompt, image or evidence text appears in
  any span attribute or event; it is mandatory.

### 9. Data model and jobs

Three tables and one column, defined in `core/schema` and mirrored with migrations in `db-sqlite`,
`db-postgres` and `db-mysql`:

- `projects.ai_profile TEXT NULL` (decision 4).
- `insights`: `id` ULID, `project_id`, `build_id` NULL (health rows), `kind` (`triage` or `health`),
  `window_key` NULL (`window` is reserved in MySQL), `input_hash`, `status` (`pending`, `running`,
  `done`, `failed`), `profile`, `model`, `prompt_version`, `verdict`, `summary`, `result` (validated JSON
  stored as text, not a dialect JSON type), `error_code` NULL, `created_at`, `started_at`,
  `finished_at`. Unique `(project_id, build_id, kind, input_hash)` for triage dedupe and unique
  `(project_id, kind, window_key)` for health; indexes on `(project_id, build_id)` and `created_at`.
- `ai_usage`: `id`, `insight_id` NULL, `project_id`, `profile`, `task`, `model`, `input_tokens`,
  `output_tokens`, `estimated`, `images`, `status` (`ok` or `failed`), `created_at`; indexes on
  `created_at` and `(project_id, created_at)`. Budget and hourly limits are `SUM` and `COUNT` over these
  rows.
- `ai_budget_alerts`: `day`, `threshold`, primary key `(day, threshold)`; an insert-or-ignore is the
  claim that makes `sys:ai-budget` fire once per threshold per day across instances.

**Job model.** The POST handler inserts the `pending` row first (the unique index dedupes concurrent
requests for the same `inputHash`; the loser returns the existing row's `Location`), then runs the work
in-process, moving the row to `running` and then `done` or `failed`. Insights do not use the capture
queue. Rows stuck in `pending` or `running` for more than 30 minutes are marked `failed` (`error_code:
"interrupted"`) by a sweep at boot and in the daily retention pass, and lazily when read.

### 10. Untrusted content and output handling

Story names, play and a11y logs, comments and branch names are attacker-influenced and reach the prompt;
the model's output reaches the UI, notifications and API clients. Therefore evidence is passed as clearly
delimited data (never concatenated into the system prompt) with an instruction to ignore directives
inside it; output is parsed against the envelope schema and rejected otherwise; every model-produced
string is rendered as plain text (escaped in JSX, no markdown or HTML, links stripped) in the UI,
notifiers and API docs; and verdicts remain advisory, so injection cannot approve, waive or merge.
Comment bodies are included only as truncated, redacted text.

### 11. UI and testing

- **UI** (through `ui/components.tsx` facades, passing `consistency.test.ts`; panels need `testing`
  and `ai`): an insight panel on the build review page (verdict, summary, per-snapshot notes,
  regenerate for approver/admin, HTMX polling); a project settings AI tab (read-only for
  non-site-admins, hidden without AI); a site-admin usage page at `/admin/ai`; and the 30-day health
  digest on Library/Builds with a project-card badge.
- **Testing.** Hermetic tests use the AI SDK's mock model (no network). Redaction, evidence limits,
  effective vision, budget sums and dedupe are pure and unit-tested; there is no live-model test.

## Alternatives considered

| Alternative                                                    | Why rejected                                                                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Bundle `@ai-sdk/*` provider packages                           | Version churn and key ownership in the wrong place; deployer-supplied instances remove both                            |
| TanStack AI                                                    | Client-oriented, immature provider ecosystem for server structured output and multimodal                               |
| Raw `httpJson` to provider REST                                | Re-owns envelopes, tool calling, multimodal parts and provider drift                                                   |
| SDK in `core`                                                  | Violates the domain-only barrel and the no-cycle rule                                                                  |
| `AiAdapter` in the adapter registry                            | One instance, no interchangeable implementations; a singleton like `Auth` avoids registry, metadata and snapshot churn |
| Separate enable and image-permission columns, or a JSON column | Subsumed by the tri-state `ai_profile`, profiles as the privacy boundary, and flat columns for three dialects          |
| `createProfile` and `createProfiles` helpers                   | Unjustified surface; generics and in-factory validation cover it                                                       |
| Per-profile budgets or per-project model picks                 | Chargeback without billing; enforce globally, observe per profile                                                      |
| Auto-approve from verdicts                                     | Breaks the human-gate invariant (roles per ADR 0011, no-waive per ADR 0004)                                            |

## Consequences

- The smallest valid deployment is one line; every refinement (vision model, second profile, caps) is
  additive. Misconfiguration fails at compile time where types reach, at creation otherwise, and
  degrades with markers at runtime, never silently.
- The self-hosted differentiator holds: a local default, data stays in the deployer's network, and
  later features add consumers and task keys only, with no contract/schema/package change.
- New runtime dependencies (`ai`, `@ai-sdk/otel`) to track for npm and JSR publishing. Peer-major
  alignment between the pinned `ai` core and user-installed `@ai-sdk/*` packages is documented; the
  startup check compares `specificationVersion`.
- The `insights` table joins the retention and purge surface.

## Open questions

- Scheduled health runs, a trend-history table, fix suggestions and model-callable tools are not
  built; insights are single-shot over fixed evidence so cost and `inputHash` stay deterministic.
- An operator option to mark a profile remote-untrusted, which would exclude comment bodies from its
  evidence.

## Links

- ADR 0015 Observability and Logging: single-owner and no-cycle rules.
- ADR 0017 MCP Server: read-only insight tools over this API.
