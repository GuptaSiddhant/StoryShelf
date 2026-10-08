# ADR 0026: AI Epic (`@storyshelf/ai` on Vercel AI SDK, Insights First)

## Status

Proposed (2026-10-06; revised 2026-10-07 — supersedes the 10-06 draft: user-supplied providers, `ai` option, profiles, single-column project gate)

## Context

StoryShelf captures everything an LLM needs for useful project insight — builds, snapshots with diff ratios, baseline freshness, play-failure logs, a11y violations, affected changed-files, comments, and cross-build history — but ships zero AI surface (no MCP server, no LLM integration). Chromatic's 2026 move (published Storybook MCP servers at `/mcp`, PR comments, auto flake traces, "UI standards even when AI codes") makes agent-consumable validated UI context the competitive front line.

Framing: **AI is the epic, insights (build triage + project health) is feature #1.** The package is named **`ai`** (`packages/ai`, `@storyshelf/ai`) so fix suggestions, comment summaries, and agent tools land later without new packages or contract rewrites.

Constraints from repo rules: single prod owner per third-party dep (AGENTS.md); `core` root barrel stays domain-only and never pulls SDK weight (ADR 0018, ADR 0022 §5 no-cycle rule); outbound discipline per ADR 0019 (domain SDKs precedented: Octokit, AWS SDK v3, `ioredis`, Better Auth); `~150`-line one-concern modules with colocated tests (`adapter-layout` skill); advisory-only verdicts (same no-auto-approve rule as ADR 0017); three-dialect schema (SQLite/Postgres/MySQL) favors flat columns over JSON.

## Decision

### 1. New package `@storyshelf/ai` — owns the `ai` core only, never provider packages

Exactly one package lists `ai` — **pinned exactly (`7.0.133`, no range)**; bumps are deliberate PRs that re-run the smoke check (Vercel core: structured output via `generateText` + `Output.object()` with the repo's zod — `generateObject` is a deprecated API in AI SDK 7 and is not used — plus multimodal parts and tool-calling) in `dependencies`, together with its telemetry bridge **`@ai-sdk/otel`** (also pinned exactly; see §8). Both are owned only by this package. Provider packages (`@ai-sdk/openai`, `@ai-sdk/anthropic`, Ollama) are **user-installed in server assembly** (`dev-server` / `fly-app` / `server init` template) and passed in as configured `LanguageModel` instances. No keys, baseUrls, or provider code in our package — a future backend (Bedrock, Azure, local server) needs zero changes on our side.

**Authentication and credentials.** Credentials never enter `@storyshelf/ai`; they live in the deployer's server assembly, inside the provider's `LanguageModel` instance. Supported routes: cloud-provider identity (Amazon Bedrock, Google Vertex, Azure OpenAI via IAM, workload identity or managed identity, preferred for enterprises), vendor API keys held as service secrets, an internal LLM gateway/proxy, or a local server (Ollama). **Consumer or seat-plan credentials are unsupported by design** — Claude Code / Claude subscription OAuth tokens and "Sign in with ChatGPT" (Codex) tokens are issued for the vendors' own clients, are seat-metered rather than per-call, and would tie a shared server to one person's refresh token. Community providers that shell out to those CLIs are likewise not documented or tested here. (Vendor terms are not verified in this ADR; confirm before publishing operator docs.) Operator docs gain a credentials page listing the supported routes.

**Vercel over TanStack, raw fetch, or SDK-in-core:** TanStack AI is client/island-oriented and immature for server structured-output; raw `httpJson` re-owns envelopes and schema repair; SDK weight in `core` would drag inference into runners/workers. The `ai` SDK's internal fetch is a domain-SDK exception under ADR 0019; timeout/retry ownership sits at our seam (`AbortSignal` + budget caps) and is mandatory test surface.

### 2. `ShelfOptions.ai: Ai` — a singleton surface (not an adapter); presence is the site switch

- `core/ai.ts` defines the `Ai` contract — a **singleton surface like `Auth` (ADR 0023), not an `Adapter`**: one per shelf, no swappable-implementation category, so `AdapterCategory`, adapter metadata, and the snapshot schema are untouched. Core owns the interface so `ShelfOptions.ai` needs no dependency edge into `@storyshelf/ai` (which already depends on core); the package implements and re-exports it. Surface: `summarize({ profile?, task, system, evidence, jsonSchema })`, `profileNames()`, `hasVision(profile?, task)`. Pure task routing and the deterministic evidence context builder live in `core/insights/` (no HTTP, no SDK) with versioned prompts (`prompts/v1.ts`, pinned + logged).
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

- `type ModelSlot = LanguageModel | { model: LanguageModel; maxTokens?: number; vision?: boolean }` — bare instance takes task defaults (`triage ~1500`, `health ~4000`); object form overrides. Task keys closed: `{ triage?, vision?, health? }`; omitted task ⇒ profile's `defaultModel`.
- Effective vision (pure, tested): explicit `vision` flag beats placement; bare model in `vision` ⇒ assumed vision; inherited-from-default requires declared `vision: true`; undeclared bare default ⇒ conservative false (no wasted failing calls). Provider rejection always falls back to text with a `visionSkipped` marker; `setup` smoke-checks without billed inference.
- `budget` is instance-level (one shared pool; profile count only labels rows for the admin dashboard). Omitted ⇒ no daily cap with the hourly abuse guard on. Usage is provider-reported, persisted per row with `{ profile, task, model }` (char/4 estimate flagged `estimated` when backends report nothing). The daily total is **summed from those rows in the database**, so the cap is enforced across all server/worker instances combined with no in-memory counter. Pre-flight global + per-project checks ⇒ 429 + `Retry-After`; failures deduct nothing. Checks are not atomic: small concurrent overspend is accepted by design. When the daily total first crosses **50%, 75%, 90% and 100%** of `dailyTokens`, site admins get a `sys:ai-budget` system notification (ADR 0024; one per threshold per day, deduped by a threshold-crossed marker row so concurrent instances don't double-send).

### 4. Project gate: one column, tri-state, privacy via profiles

```sql
ai_profile TEXT NULL   -- NULL = off; 'default' = default profile; else named profile ('' rejected; unknown ⇒ effective-default + warning badge)
```

`ai_enabled` and `ai_allow_images` were considered and removed: the former is subsumed by `NULL`, the latter by profile choice (local-vision/text-only profiles for sensitive teams vs cloud-vision profiles — the admin's explicit data-flow decision, zero extra columns). No `orgs` entity is introduced; multi-tenancy stays deferred.

### 5. Insights v1 (triage + health, multimodal, advisory-only)

Both scopes day one over the shared pipeline, with deterministic evidence limits (defaults, overridable in `createAi` options):

- **Thumbnails:** at most 3 per call, ranked by diff ratio then failure status; 512px long edge, JPEG. The manifest notes "N more omitted".
- **Logs:** play and a11y logs keep the first 2 KB and last 2 KB per failing snapshot with a "truncated N bytes" marker; total text evidence capped at ~24 KB with a fixed field order so the cut is deterministic.
- **Snapshot rows:** at most 50 changed snapshots by diff ratio; the rest aggregated as counts.
- **Redaction** runs before truncation and does not count toward the caps.
- **`inputHash`** covers the final assembled evidence plus prompt version, task, profile and model: a model or prompt bump regenerates, identical evidence is a free cache hit.

Build insights are cached in a new `insights` table, purged with their build. **Project-health rows have no build, so retention is time-based:** one row per project and window, replaced on regeneration (a snapshot, not an audit trail); the existing purge job deletes rows past the retention horizon and rows of archived/deleted projects. Optional trend history, if added later, is a flat table capped at 30 rows per project holding only score and counts, never model prose. Verdicts never approve, waive play failures, or override `409 baseline_changed`. MCP tools (`get_build_insight`, `get_project_health`) and the `insight:ready` notifier digest consume the same seam. `insight:ready` (project topic) and `sys:ai-budget` (admin topic, §3) are new topics this ADR adds to the ADR 0024 event catalog (opt-in, same fan-out).

### 6. API access (first-class `/api/v1`, no new auth machinery)

New `routers/insights.ts` (+ `insights.handlers.ts` past ~150 lines), `app.openapi` routes with `schemas.ts` entries so insights land in `openapi.json` (website docs + type-safe CLI/MCP clients). No DELETE — rows die with builds via retention purge. No SSE in v1 — cache-hit-200 else 202 + poll matches the upload→202→queue async pattern.

| Method | Route | Roles | Behavior |
|---|---|---|---|
| `GET` | `/projects/:id/builds/:buildId/insights/latest` | `VIEW_ROLES` (all four) | Cached triage; `404 never-generated` with creation hint |
| `GET` | `/projects/:id/builds/:buildId/insights` | `VIEW_ROLES` | Bounded history list (`?limit`) |
| `POST` | `/projects/:id/builds/:buildId/insights` | `["approver", "admin"]` | `{ task?, profile?, force? }` → `inputHash` hit returns 200 unbilled; else budget pre-check (429 + `Retry-After`) → 202 with `Location` |
| `GET` | `/projects/:id/insights/health?window=30d` | `VIEW_ROLES` | Cached digest; `404` + refresh hint |
| `POST` | `/projects/:id/insights/health` | `["approver", "admin"]` | `{ window? }` → 202 background run |

Roles are **exact-match lists, not hierarchy** (`requireRole`/`assertRole` use `includes` — there is no "developer+"; regenerate uses the existing `APPROVER_ROLES` (approver + admin), per the ADR 0010 approver/developer split: regeneration spends shared budget and shapes review, so it sits with the merge-green-light role while developers read only; loosening later is one line). The router reuses the existing `VIEW_ROLES` constant (exported from `builds.handlers.ts`; no third copy) and `requireRole`/`assertRole` from `helpers.ts`. Session and Bearer paths share the existing `helpers.ts` resolution (legacy ownerless tokens ⇒ viewer: reads yes, regenerate 403; cross-project tokens ⇒ scoped 404; site admin bypass unchanged). Guard order: `ai` not configured ⇒ `501 ai-disabled`; `ai_profile IS NULL` ⇒ `409 ai-disabled-for-project`; role; budget; isolated rate-limit bucket (same pattern as the `auth:`/`engine:` buckets). Fallbacks are envelope fields (`profileRequested`/`profileEffective`/`warnings[]`, `visionSkipped`, `usage.estimated`), never prose.

### 7. Layout (per `adapter-layout`)

`packages/ai/src/`: `types.ts` (options/slots only), `client.ts` (slot resolution + validation, `resolveSlot` normalizer), `codec.ts` (evidence → messages, `generateText` with `Output.object()` + one schema-repair retry), `operations.ts` (`summarize` + budget guards), `lifecycle.ts` (`setup/health/teardown`; health probes, no inference), `index.ts` (factory first, re-exports bottom). Exports map frozen at `"."`; future subpaths need owner approval.

### 8. Observability (OTEL, per ADR 0022 — no new wiring)

AI SDK 7 moved span collection out of `ai` into `@ai-sdk/otel`: nothing is emitted until an integration is registered with `registerTelemetry(new OpenTelemetry())`, and once one is registered **telemetry is opt-out** — every SDK call emits, recording inputs and outputs by default. `@storyshelf/ai` therefore depends on `@opentelemetry/api` (zero-dep shim) and `@ai-sdk/otel`, and never imports `@storyshelf/observability` — the §5 no-cycle rule applies unchanged, so the `withSpan`/propagation helper gets its intentional copy inside `ai` (do not deduplicate). The existing `initObservabilityFromEnv()` + `otelLogMixin` preamble in `dev-server`/`fly-app`/templates covers the tracer provider with no changes. `lifecycle.setup()` registers the `OpenTelemetry` integration once (idempotent, default global tracer) only when OTEL is enabled by the host; with OTEL off nothing is registered, so no SDK call emits and behavior noops identically. Tests use the in-memory exporter precedent.

- Spans: one `ai.summarize` root per call (nests under the request's `http.server` span for on-demand triage; fresh root per scheduled health run, same as retention-timer jobs), with a child `ai.build_context` (evidence assembly). The inference call is **not** wrapped in our own span: the SDK's `OpenTelemetry` integration emits GenAI semantic-convention spans (`invoke_agent {model}` and `chat {model}` with `gen_ai.usage.*` token attributes) that nest under `ai.summarize`; fallback markers are events on the root. Our attributes carry only `ai.task`, `ai.profile` (bounded admin-configured names), `ai.model` — never prompts, screenshots, story/build IDs, or secrets.
- Metrics (bounded cardinality, §7 precedent): `ai.summarize.duration` and `ai.summarize.tokens` histograms (attr `ai.task` + outcome only — model/profile stay on spans and DB rows), `ai.insights.completed`/`failed` counters. No per-story, per-build, or per-profile series.
- Logs: free via the host-owned logger (`setLogger`) + existing mixin (`trace_id`/`span_id`); log task/profile/model/outcome/usage, never evidence.
- Because SDK telemetry is opt-out once registered, **every** SDK call from `codec.ts` passes an explicit `telemetry: { functionId: "storyshelf-{task}", recordInputs: false, recordOutputs: false }` (never `isEnabled: true`, never `includeRuntimeContext`/`includeToolsContext`, so no runtime context reaches the backend) — screenshots and prompts must never enter the trace backend (same rule as §7's path exclusion, extended to evidence). A test with the in-memory exporter asserts no prompt, image or evidence text appears in any span attribute or event. Operator docs gain an `ai.*` span/metric row in `docs/observability.md`.

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
- Peer-major alignment between our pinned `ai` core and user-installed `@ai-sdk/*` must be documented, with a startup smoke check.
- `insights` table joins retention/purge surface (build-linked rows with builds, health rows by time).

## Links

- `packages/core/src/auth.ts` — singleton-surface-in-core precedent (`Auth`, not an adapter)
- `packages/core/src/adapters/capture-runner.ts` — interface-in-core / implementation-in-package precedent
- `packages/core/src/adapters/notifier/provider.ts` — descriptor + runtime split precedent
- `docs/adr/0017-interaction-testing-via-play-function.md` — advisory-only / no-waive rule
- `docs/adr/0019-shared-http-helper.md` — outbound discipline; domain-SDK exception
- `docs/adr/0022-opentelemetry-observability.md` — single-owner + no-cycle precedent
- `docs/adr/0024-notification-adapters.md` — event catalog extended with `insight:ready`
