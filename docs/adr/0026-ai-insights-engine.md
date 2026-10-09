# ADR 0026: AI Epic (`@storyshelf/ai` on Vercel AI SDK, Insights First)

## Status

Proposed (2026-10-06; revised 2026-10-09 to match the implementation in the same PR — supersedes the 10-06 draft: user-supplied providers, `ai` option, profiles, single-column project gate)

## Context

StoryShelf captures everything an LLM needs for useful project insight — builds, snapshots with diff ratios, baseline freshness, play-failure logs, a11y violations, affected changed-files, comments, and cross-build history — but ships zero AI surface (no MCP server, no LLM integration). Chromatic's 2026 move (published Storybook MCP servers at `/mcp`, PR comments, auto flake traces, "UI standards even when AI codes") makes agent-consumable validated UI context the competitive front line.

Framing: **AI is the epic, insights (build triage + project health) is feature #1.** The package is named **`ai`** (`packages/ai`, `@storyshelf/ai`) so fix suggestions, comment summaries, and agent tools land later without new packages or contract rewrites.

Constraints from repo rules: single prod owner per third-party dep (AGENTS.md); `core` root barrel stays domain-only and never pulls SDK weight (ADR 0018, ADR 0022 §5 no-cycle rule); outbound discipline per ADR 0019 (domain SDKs precedented: Octokit, AWS SDK v3, `ioredis`, Better Auth); `~150`-line one-concern modules with colocated tests (`adapter-layout` skill); advisory-only verdicts (same no-auto-approve rule as ADR 0017); three-dialect schema (SQLite/Postgres/MySQL) favors flat columns over JSON.

## Decision

### 1. New package `@storyshelf/ai` — owns the `ai` core only, never provider packages

Exactly one package lists `ai` — **pinned exactly (`7.0.133`, no range)**; bumps are deliberate PRs that re-run the smoke check (Vercel core: structured output via `generateText` + `Output.object()` with the repo's zod — `generateObject` is a deprecated API in AI SDK 7 and is not used — plus multimodal parts; model-callable tools are not used in v1, §11) in `dependencies`, together with its telemetry bridge **`@ai-sdk/otel`** (also pinned exactly; see §8). Both are owned only by this package. Provider packages (`@ai-sdk/openai`, `@ai-sdk/anthropic`, Ollama) are **user-installed in server assembly** (`dev-server` / `fly-app` / `server init` template) and passed in as configured `LanguageModel` instances. No keys, baseUrls, or provider code in our package — a future backend (Bedrock, Azure, local server) needs zero changes on our side.

**Authentication and credentials.** Credentials never enter `@storyshelf/ai`; they live in the deployer's server assembly, inside the provider's `LanguageModel` instance. Supported routes: cloud-provider identity (Amazon Bedrock, Google Vertex, Azure OpenAI via IAM, workload identity or managed identity, preferred for enterprises), vendor API keys held as service secrets, an internal LLM gateway/proxy, or a local server (Ollama). **Consumer or seat-plan credentials are unsupported by design** — Claude Code / Claude subscription OAuth tokens and "Sign in with ChatGPT" (Codex) tokens are issued for the vendors' own clients, are seat-metered rather than per-call, and would tie a shared server to one person's refresh token. Community providers that shell out to those CLIs are likewise not documented or tested here. (Vendor terms are not verified in this ADR; confirm before publishing operator docs.) Operator docs gain a credentials page listing the supported routes. The website docs also gain a guide on getting free or low-cost AI access for testing (e.g. Google AI Studio, OpenRouter, or a local Ollama), covering how to wire the provider into server assembly and warning that free tiers may log or train on prompts and screenshots, so they suit test data only.

**Vercel over TanStack, raw fetch, or SDK-in-core:** TanStack AI is client/island-oriented and immature for server structured-output; raw `httpJson` re-owns envelopes and schema repair; SDK weight in `core` would drag inference into runners/workers. The `ai` SDK's internal fetch is a domain-SDK exception under ADR 0019; timeout/retry ownership sits at our seam (`AbortSignal` + budget caps) and is mandatory test surface.

### 2. `ShelfOptions.ai: Ai` — a singleton surface (not an adapter); presence is the site switch

- `core/ai.ts` defines the `Ai` contract — a **singleton surface like `Auth` (ADR 0023), not an `Adapter`**: one per shelf, no swappable-implementation category, so `AdapterCategory`, adapter metadata, and the snapshot schema are untouched. Core owns the interface so `ShelfOptions.ai` needs no dependency edge into `@storyshelf/ai` (which already depends on core); the package implements and re-exports it. Surface: `summarize({ profile?, task, system, evidence, schema })` (`task` is `"triage" | "health"`; `schema` is a zod schema; the result envelope schema lives in core), `profileNames()`, `defaultProfile()`, `hasVision(profile?, task)`, `modelId(profile?, task)`, `budget()`, `limits()`, `timeoutMs(profile?, task)`, optional `setLogger`, and `setup()`/`health()`/`teardown()` (free checks only). The deterministic evidence builders live in `core/insights` (exported as the `@storyshelf/core/insights` subpath alongside `@storyshelf/core/ai`). Pure task routing and the deterministic evidence context builder live in `core/insights/` (no HTTP, no SDK) with versioned prompts (`prompts/v1.ts`, pinned + logged).
- `ShelfOptions` gains `ai?: Ai`, wired like `auth` (optional singleton; logger bound by the host). **Set ⇒ AI on site-wide; absent ⇒ off** (`501 ai-disabled`, UI inert). There is **no `ShelfConfig`** for AI — caps live in the `createAi` options beside the models they govern; per-project choice is one column (§4).
- No `createProfile`/`createProfiles` helpers (rejected as unjustified surface): one export, `createAi`, plus types. Profile-name safety comes from a `const` generic (`defaultProfile?: NoInfer<P>`, closed task-key union, `null` only on `vision`), so misconfiguration is a compile error, not a boot crash.

### 3. One call shape: `profiles` always, `ModelSlot` shorthand, instance-level budget

```ts
createAi({
  profiles: {
    default:  { defaultModel: ollama("qwen2.5:14b") },
    thorough: { defaultModel: openai("gpt-4o-mini"),
                models: { vision: anthropic("claude-sonnet-4-5") } },
  },
  defaultProfile: "default",  // optional: "default" key if present, else first key
  budget: { dailyTokens: 2_000_000, visionWeight: 5, perProjectCallsPerHour: 50 }, // optional
});
```

- `type ModelSlot = LanguageModel | { model: LanguageModel; maxTokens?: number; vision?: boolean; timeoutMs?: number; providerOptions?: ProviderOptions }` — bare instance takes task defaults (`triage ~1500`, `health ~4000`); object form overrides. Slot keys closed: `{ triage?, vision?, health? }` — `triage` and `health` are the two tasks; `vision` is a **modality slot** used by `triage` when images are sent, not a task of its own. Omitted slot ⇒ profile's `defaultModel`.
- **Timeouts and retries.** The SDK's `maxRetries` is set to `0` (no hidden retries doubling spend); our seam owns the single schema-repair retry. Per-slot `timeoutMs` (defaults: triage 60 s, health 180 s) is enforced via `AbortSignal` and configurable in the object slot form for slow local models. A timed-out call is `failed`; any usage it reported is recorded.
- `providerOptions` is an opaque, optional pass-through to the SDK's per-call provider settings (reasoning effort or thinking budget — reasoning models can spend the whole output cap and return nothing — plus gateway routing/data policies); it adds no provider code to this package, and users may equally bake settings into the model with the SDK's settings middleware. The `vision` slot is used **only when images are actually sent**: text-only calls use the task/default model, and `Ai.modelId`/`timeoutMs` take `withImages` so cache hashes name the model that really ran.
- Effective vision (pure, tested): explicit `vision` flag beats placement; bare model in `vision` ⇒ assumed vision; inherited-from-default requires declared `vision: true`; undeclared bare default ⇒ conservative false (no wasted failing calls). Provider rejection always falls back to text with a `visionSkipped` marker; `setup` runs only free checks — each model's `specificationVersion` against what the pinned `ai` supports and provider reachability where cheap; **vision capability cannot be verified without a billed call and is not.**
- `budget` is instance-level (one shared pool, daily window = **UTC day**; `visionWeight` multiplies the tokens counted for any call that sent images, because providers under-report image cost; at 100% new calls get `429` until the next UTC day while cache hits are still served; profile count only labels rows for the admin dashboard). Omitted ⇒ no daily cap with the hourly abuse guard on. Usage is provider-reported, persisted per row with `{ profile, task, model }` (char/4 estimate flagged `estimated` when backends report nothing). The daily total is **summed from those rows in the database**, so the cap is enforced across all server/worker instances combined with no in-memory counter. Pre-flight global + per-project checks ⇒ 429 + `Retry-After`; calls that fail after the provider reported usage still record a `failed` usage row and **count toward the budget** (the provider billed them); calls with no reported usage count nothing. Checks are not atomic: small concurrent overspend is accepted by design. When the daily total first crosses **50%, 75%, 90% and 100%** of `dailyTokens`, site admins get a `sys:ai-budget` system notification (ADR 0024; one per threshold per day, deduped by a threshold-crossed marker row so concurrent instances don't double-send).

### 4. Project gate: one column, tri-state, privacy via profiles

```sql
ai_profile TEXT NULL   -- NULL = off; 'default' = default profile; else named profile ('' rejected; unknown ⇒ effective-default + warning badge)
```

**Who sets it:** site admins only in v1 (it is the data-flow decision), through the project settings UI and the project PATCH API; project admins can see it read-only. `ai_enabled` and `ai_allow_images` were considered and removed: the former is subsumed by `NULL`, the latter by profile choice (local-vision/text-only profiles for sensitive teams vs cloud-vision profiles — the admin's explicit data-flow decision, zero extra columns). No `orgs` entity is introduced; multi-tenancy stays deferred.

### 5. Insights v1 (triage + health, multimodal, advisory-only)

Both scopes day one over the shared pipeline, with deterministic evidence limits (defaults, overridable in `createAi` options):

- **Thumbnails:** at most 3 per call, ranked by diff ratio then failure status; 512px long edge, **kept as PNG** and downscaled with the existing `pngjs` (no new image dependency). The manifest notes "N more omitted".
- **Logs:** play and a11y logs keep the first 2 KB and last 2 KB per failing snapshot with a "truncated N bytes" marker; total text evidence capped at ~24 KB with a fixed field order so the cut is deterministic.
- **Snapshot rows:** at most 50 changed snapshots by diff ratio; the rest aggregated as counts.
- **Redaction** (`core/insights/redact.ts`, tested with fixtures) runs before truncation and does not count toward the caps. Rules: values of keys matching `secret|token|password|api[_-]?key|authorization|cookie`; `Bearer`/`Basic` credentials; URLs with userinfo; JWTs; common key prefixes (`sk-`, `ghp_`, `AKIA`, `xox`); long base64/hex runs (≥ 32 chars). Unmatched content is not assumed safe — evidence also excludes env dumps and request headers by construction.
- **Result envelope** (zod, in core): `{ verdict: "likely-intended" | "needs-review" | "likely-regression", summary: string, items: { snapshotKey, note, severity }[], confidence: "low" | "medium" | "high" }`; health adds `{ score, trends[] }`. Stored as an opaque validated text column, never queried.
- The evidence builder is pure: it receives already-loaded inputs (rows, log text, PNG buffers); the handler/operation layer loads them from the database and storage.
- **`inputHash`** covers the final assembled evidence plus prompt version, task, profile and model: a model or prompt bump regenerates, identical evidence is a free cache hit.

Build insights are cached in a new `insights` table, purged with their build. **Project-health rows have no build, so retention is time-based:** one row per project and window, replaced on regeneration (a snapshot, not an audit trail); the existing purge job deletes health rows older than **90 days** and rows of archived/deleted projects; build-linked rows are deleted **explicitly** in `core/retention/purge.ts` with their build (no reliance on dialect FK cascade). Optional trend history, if added later, is a flat table capped at 30 rows per project holding only score and counts, never model prose. Verdicts never approve, waive play failures, or override `409 baseline_changed`. The `insight:ready` notifier digest consumes the same seam; MCP tools are deferred (§11). `insight:ready` (project topic) and `sys:ai-budget` (admin topic, §3) are new topics this ADR adds to the ADR 0024 event catalog (opt-in, same fan-out).

### 6. API access (first-class `/api/v1`, no new auth machinery)

Routes follow the existing `/api/v1/projects/{slug}/…` convention (slug, not id). New `routers/insights.ts` (+ `insights.handlers.ts` for the guards), `app.openapi` routes with `schemas.ts` entries so insights land in `openapi.json` (website docs + type-safe CLI/MCP clients). No DELETE — rows die with builds via retention purge. No SSE in v1 — cache-hit-200 else 202 + poll matches the upload→202→queue async pattern.

| Method | Route | Roles | Behavior |
|---|---|---|---|
| `GET` | `/projects/{slug}/builds/{buildId}/insights/latest` | `VIEW_ROLES` (all four) | Cached triage; `404 never-generated` with creation hint; while a run exists the response carries `status` (`pending`/`running`/`failed`/`done`) and, on `failed`, a bounded error code |
| `GET` | `/projects/{slug}/builds/{buildId}/insights` | `VIEW_ROLES` | Bounded history list (`?limit`) |
| `POST` | `/projects/{slug}/builds/{buildId}/insights` | `["approver", "admin"]` | `{ task?, force?, profile? }` → `inputHash` hit returns 200 unbilled (`force` bypasses the cache and is billed); else budget pre-check (429 + `Retry-After`) → 202 with `Location`. **`profile` is honoured for site admins only**; for everyone else the project's `ai_profile` is used, so an approver cannot route data to a profile the site admin did not choose for that project |
| `GET` | `/projects/{slug}/insights/health?window=30d` | `VIEW_ROLES` | Cached digest; `404` + refresh hint |
| `POST` | `/projects/{slug}/insights/health` | `["approver", "admin"]` | `{ window? }` → 202 on-demand run (no scheduler in v1) |

Roles are **exact-match lists, not hierarchy** (`requireRole`/`assertRole` use `includes` — there is no "developer+"; regenerate uses the existing `APPROVER_ROLES` (approver + admin), per the ADR 0010 approver/developer split: regeneration spends shared budget and shapes review, so it sits with the merge-green-light role while developers read only; loosening later is one line). The router reuses the existing `VIEW_ROLES` constant (exported from `builds.handlers.ts`; no third copy) and `requireRole`/`assertRole` from `helpers.ts`. Session and Bearer paths share the existing `helpers.ts` resolution (legacy ownerless tokens ⇒ viewer: reads yes, regenerate 403; cross-project tokens ⇒ scoped 404; site admin bypass unchanged). Guard order: `ai` not configured ⇒ `501 ai-disabled`; `ai_profile IS NULL` ⇒ `409 ai-disabled-for-project`; role; budget; isolated in-memory rate-limit bucket (same pattern as the `auth:`/`engine:` buckets) as a coarse per-instance abuse guard only; the authoritative hourly/daily limits (`perProjectCallsPerHour`, `dailyTokens`) are **counted from the usage rows in the database**, so they hold across instances. Fallbacks are envelope fields (`profileRequested`/`profileEffective`/`warnings[]`, `visionSkipped`, `usage.estimated`), never prose.

### 7. Layout (per `adapter-layout`)

`packages/ai/src/` is stateless inference: `types.ts` (options/slots only), `client.ts` (slot resolution, effective-vision rules, validation), `codec.ts` (evidence → messages, `generateText` with `Output.object()` + one schema-repair retry, usage mapping), `operations.ts` (`summarize`: profile fallback, vision fallback, timeout, span), `state.ts`, `telemetry.ts` (registration + local `withSpan`), `metrics.ts`, `lifecycle.ts` (`setup/health`; free checks only), `index.ts` (`createAi` first, re-exports bottom). Exports map frozen at `"."`.

The parts that need the database live outside the package: pure evidence/redaction/hash/budget math in `core/insights`, models in `core/models` (`InsightModel`, `AiUsageModel`, `AiBudgetAlertModel`), and in `packages/app/src/insights/` the DB-backed budget guard (`budget.ts`), evidence loaders, request orchestration and background jobs. The `Ai` contract is the seam, so `@storyshelf/ai` never imports the database.

### 8. Observability (OTEL, per ADR 0022 — no new wiring)

AI SDK 7 moved span collection out of `ai` into `@ai-sdk/otel`: nothing is emitted until an integration is registered with `registerTelemetry(new OpenTelemetry())`, and once one is registered **telemetry is opt-out** — every SDK call emits, recording inputs and outputs by default. `@storyshelf/ai` therefore depends on `@opentelemetry/api` (zero-dep shim) and `@ai-sdk/otel`, and never imports `@storyshelf/observability` — the §5 no-cycle rule applies unchanged, so the `withSpan`/propagation helper gets its intentional copy inside `ai` (do not deduplicate). The existing `initObservabilityFromEnv()` + `otelLogMixin` preamble in `dev-server`/`fly-app`/templates covers the tracer provider with no changes. `lifecycle.setup()` registers the `OpenTelemetry` integration once (idempotent, default global tracer) only when OTEL is enabled by the host (`createAi({ otel })`, defaulting to on when `OTEL_EXPORTER_OTLP_ENDPOINT` is set or `OTEL_DENO=true`); with OTEL off nothing is registered, so no SDK call emits and behavior noops identically. Tests use the in-memory exporter precedent.

- Spans: one `ai.summarize` root per call (nests under the request's `http.server` span for on-demand triage; fresh root per on-demand health run (no scheduler in v1)), The inference call is **not** wrapped in our own span: the SDK's `OpenTelemetry` integration emits GenAI semantic-convention spans (`invoke_agent {model}` and `chat {model}` with `gen_ai.usage.*` token attributes) that nest under `ai.summarize`; fallback markers are events on the root. Our attributes carry only `ai.task`, `ai.profile` (bounded admin-configured names), `ai.model` — never prompts, screenshots, story/build IDs, or secrets.
- Metrics (bounded cardinality, §7 precedent): `ai.summarize.duration` and `ai.summarize.tokens` histograms (attr `ai.task` + outcome only — model/profile stay on spans and DB rows), `ai.insights.completed`/`failed` counters (attr `ai.task`). No per-story, per-build, or per-profile series.
- Logs: free via the host-owned logger (`setLogger`) + existing mixin (`trace_id`/`span_id`); log task/profile/model/outcome/usage, never evidence.
- Because SDK telemetry is opt-out once registered, **every** SDK call from `codec.ts` passes an explicit `telemetry: { functionId: "storyshelf-{task}", recordInputs: false, recordOutputs: false }` (never `isEnabled: true`, never `includeRuntimeContext`/`includeToolsContext`, so no runtime context reaches the backend) — screenshots and prompts must never enter the trace backend (same rule as §7's path exclusion, extended to evidence). A test with the in-memory exporter asserts no prompt, image or evidence text appears in any span attribute or event. Operator docs gain an `ai.*` span/metric row in `docs/observability.md`.

### 9. Data model and jobs

Three new tables plus one column, defined in `core/schema` and mirrored (with migrations) in `db-sqlite`, `db-postgres` and `db-mysql`:

- `projects.ai_profile TEXT NULL` (§4).
- `insights`: `id` ULID, `project_id`, `build_id` NULL (health rows), `kind` (`triage`/`health`), `window_key` NULL (`window` is a reserved word in MySQL), `input_hash`, `status` (`pending`/`running`/`done`/`failed`), `profile`, `model`, `prompt_version`, `verdict`, `summary`, `result` (opaque validated JSON as text, not a dialect JSON type), `error_code` NULL, `created_at`, `started_at`, `finished_at`. Unique `(project_id, build_id, kind, input_hash)` for triage dedupe and unique `(project_id, kind, window_key)` for health (replaced in place); indexes on `(project_id, build_id)` and `created_at`.
- `ai_usage`: `id`, `insight_id` NULL, `project_id`, `profile`, `task`, `model`, `input_tokens`, `output_tokens`, `estimated`, `images`, `status` (`ok`/`failed`), `created_at`; indexes on `created_at` and `(project_id, created_at)`. Budget and hourly limits are `SUM`/`COUNT` over these rows.
- `ai_budget_alerts`: `day`, `threshold`, primary key `(day, threshold)`; an insert-or-ignore is the claim that makes `sys:ai-budget` fire once per threshold per day across instances.

**Job model.** The POST handler inserts the `pending` row first (the unique index dedupes concurrent requests for the same `inputHash`: the loser returns the existing row's `Location`), then runs the work in-process, moving the row to `running` and `done`/`failed`. v1 does not use the capture queue or remote workers. Rows stuck in `pending`/`running` for more than 30 minutes are marked `failed` (`error_code: "interrupted"`) by a sweep at boot and in the daily retention pass, and lazily when read.

### 10. Untrusted content and output handling

Story names, play/a11y logs, comments and branch names are attacker-influenced and reach the prompt; the model's output reaches the UI, notifications and API clients. Therefore: evidence is passed as clearly delimited data (never concatenated into the system prompt) with an instruction to ignore directives inside it; output is parsed against the envelope schema and rejected otherwise; every string from the model is rendered as **plain text** (escaped in JSX, no markdown/HTML, links stripped) in the UI, notifiers and API docs; verdicts remain advisory (§5), so injection cannot approve, waive or merge. Comment bodies are included only as truncated, redacted text and are excluded when `ai_profile` points at a profile marked remote-untrusted by the operator (future option; not v1).

### 11. Testing and scope

- **Testing.** Hermetic tests use the AI SDK's mock language model (no network); the redaction, evidence-limit, effective-vision, budget-sum and dedupe logic are pure and unit-tested; no live-model or Ollama integration test in v1 (deferred). The OTEL leak test (§8) is mandatory.
- **UI.** v1 adds (a) an insight panel on the build review page (verdict, summary, per-snapshot notes, regenerate button for approver/admin, HTMX polling while running), (b) a project settings **AI** tab (read-only for non-site-admins; the tab is hidden when no AI is configured), and (c) a site-admin usage page at `/admin/ai` (tokens by day and profile). The project health digest (30-day window) is also shown as a panel with a generate/refresh button on the project Library and Builds pages, and as a `health` badge on the project card once a digest has finished. All use the `ui/components.tsx` facades and pass `consistency.test.ts`.
- **Out of scope for v1.** The MCP tools `get_build_insight`/`get_project_health` (no MCP server exists in the repo; [ADR 0027](0027-mcp-server.md) defines the server and these tools), scheduled health runs, trend-history table, fix suggestions, and model-callable tools (insights are single-shot over fixed evidence so cost and the `inputHash` stay deterministic).

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| Bundle `@ai-sdk/*` in our deps | Version churn + key ownership in the wrong place; deployer-supplied instances remove both |
| TanStack AI | Client-oriented, immature provider ecosystem for server structured-output + multimodal |
| Raw `httpJson` to provider REST | Re-owns envelopes, tool-calling, multimodal parts, provider drift |
| SDK in `core` | Violates domain-only barrel + no-cycle rule |
| `insights` key / `insights_enabled` / `ai_allow_images` / JSON column | Subsumed: `ai` property, `ai_profile` tri-state, profiles-as-privacy-boundary, flat columns for three dialects |
| `AiAdapter` in the adapter registry (`AdapterCategory "ai"`) | One instance, no interchangeable implementations; a singleton like `Auth` avoids registry/metadata/snapshot churn |
| `createProfile`/`createProfiles` helpers | Unjustified surface; generics + in-factory validation cover it (same lesson as the auth-adapter collapse) |
| Per-profile budgets / per-project model picks | Chargeback without billing; enforce globally, observe per-profile, refine on dashboard evidence |
| Auto-approve from verdicts | Breaks human-gate invariant (ADR 0010 roles, ADR 0017 no-waive) |

## Consequences

**Positive:**
- Smallest valid deployment is one line (`profiles: { default: { defaultModel } }`); every refinement (vision model, second profile, caps) is additive, never a rewrite; misconfiguration fails at compile time where types reach, at creation otherwise, and degrades with markers at runtime — never silently.
- Self-hosted differentiator preserved: local default, data stays in VPC, unlimited agent iteration with no per-snapshot tax.
- Feature #2+ (summaries, fix suggestions) adds consumers and task keys only — no contract, schema, or package changes.

**Negative:**
- New runtime deps (`ai` core, `@ai-sdk/otel`) to track for npm/JSR publish (LICENSE/README/deno.json checklist).
- Peer-major alignment between our pinned `ai` core and user-installed `@ai-sdk/*` must be documented; the startup check compares `specificationVersion` (§3).
- `insights` table joins retention/purge surface (build-linked rows with builds, health rows by time).

## Links

- `packages/core/src/auth.ts` — singleton-surface-in-core precedent (`Auth`, not an adapter)
- `packages/core/src/adapters/capture-runner.ts` — interface-in-core / implementation-in-package precedent
- `packages/core/src/adapters/notifier/provider.ts` — descriptor + runtime split precedent
- `docs/adr/0017-interaction-testing-via-play-function.md` — advisory-only / no-waive rule
- `docs/adr/0019-shared-http-helper.md` — outbound discipline; domain-SDK exception
- `docs/adr/0022-opentelemetry-observability.md` — single-owner + no-cycle precedent
- `docs/adr/0024-notification-adapters.md` — event catalog extended with `insight:ready`
