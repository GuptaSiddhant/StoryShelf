# ADR 0026: AI Epic (`@storyshelf/ai` on Vercel AI SDK, Insights First)

## Status

Accepted (2026-10-06; revised 2026-10-07 — supersedes the 10-06 draft: user-supplied providers, `ai` option, profiles, single-column project gate)

## Context

StoryShelf captures everything an LLM needs for useful project insight — builds, snapshots with diff ratios, baseline freshness, play-failure logs, a11y violations, affected changed-files, comments, and cross-build history — but ships zero AI surface (no MCP server, no LLM integration). Chromatic's 2026 move (published Storybook MCP servers at `/mcp`, PR comments, auto flake traces, "UI standards even when AI codes") makes agent-consumable validated UI context the competitive front line.

Framing: **AI is the epic, insights (build triage + project health) is feature #1.** The package is named **`ai`** (`packages/ai`, `@storyshelf/ai`) so fix suggestions, comment summaries, and agent tools land later without new packages or contract rewrites.

Constraints from repo rules: single prod owner per third-party dep (AGENTS.md); `core` root barrel stays domain-only and never pulls SDK weight (ADR 0018, ADR 0022 §5 no-cycle rule); outbound discipline per ADR 0019 (domain SDKs precedented: Octokit, AWS SDK v3, `ioredis`, Better Auth); `~150`-line one-concern modules with colocated tests (`adapter-layout` skill); advisory-only verdicts (same no-auto-approve rule as ADR 0017); three-dialect schema (SQLite/Postgres/MySQL) favors flat columns over JSON.

## Decision

### 1. New package `@storyshelf/ai` — owns the `ai` core only, never provider packages

Exactly one package lists `ai` (Vercel core: `generateObject` with the repo's zod, multimodal parts, tool-calling, OTEL hooks) in `dependencies`. Provider packages (`@ai-sdk/openai`, `@ai-sdk/anthropic`, Ollama) are **user-installed in server assembly** (`dev-server` / `fly-app` / `server init` template) and passed in as configured `LanguageModel` instances. No keys, baseUrls, or provider code in our package — a future backend (Bedrock, Azure, local server) needs zero changes on our side.

**Vercel over TanStack, raw fetch, or SDK-in-core:** TanStack AI is client/island-oriented and immature for server structured-output; raw `httpJson` re-owns envelopes and schema repair; SDK weight in `core` would drag inference into runners/workers. The `ai` SDK's internal fetch is a domain-SDK exception under ADR 0019; timeout/retry ownership sits at our seam (`AbortSignal` + budget caps) and is mandatory test surface.

### 2. `ShelfOptions.ai: AiAdapter` — presence is the site switch

- `core/adapters/ai.ts` defines `AiAdapter extends Adapter<{ category: "ai" }>` (`"ai"` added to `AdapterCategory` + snapshot schema): `summarize({ profile?, task, system, evidence, jsonSchema })`, `profileNames()`, `hasVision(profile?, task)`. Pure task routing and the deterministic evidence context builder live in `core/insights/` (no HTTP, no SDK) with versioned prompts (`prompts/v1.ts`, pinned + logged).
- `ShelfOptions` gains `ai?: AiAdapter`, wired like `captureRunner`/`notifiers`/`gitHosts`. **Set ⇒ AI on site-wide; absent ⇒ off** (`501 ai-disabled`, UI inert). There is **no `ShelfConfig`** for AI — caps live in the adapter options beside the models they govern; per-project choice is one column (§4).
- No `createProfile`/`createProfiles` helpers (rejected as unjustified surface): one export, `createAiAdapter`, plus types. Profile-name safety comes from a `const` generic (`defaultProfile?: NoInfer<P>`, closed task-key union, `null` only on `vision`), so misconfiguration is a compile error, not a boot crash.

### 3. One call shape: `profiles` always, `ModelSlot` shorthand, adapter-level budget

```ts
createAiAdapter({
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
- `budget` is adapter-level (one shared pool; profile count only labels rows for the admin dashboard). Omitted ⇒ no daily cap with the hourly abuse guard on. Usage is provider-reported, persisted per row with `{ profile, task, model }` (char/4 estimate flagged `estimated` when backends report nothing); pre-flight global + per-project checks ⇒ 429 + `Retry-After`; failures deduct nothing.

### 4. Project gate: one column, tri-state, privacy via profiles

```sql
ai_profile TEXT NULL   -- NULL = off; 'default' = default profile; else named profile ('' rejected; unknown ⇒ effective-default + warning badge)
```

`ai_enabled` and `ai_allow_images` were considered and removed: the former is subsumed by `NULL`, the latter by profile choice (local-vision/text-only profiles for sensitive teams vs cloud-vision profiles — the admin's explicit data-flow decision, zero extra columns). No `orgs` entity is introduced; multi-tenancy stays deferred.

### 5. Insights v1 (triage + health, multimodal, advisory-only)

Both scopes day one over the shared pipeline: thumbnails only (max 3, 512px), logs truncated head/tail, secrets redacted. Results cached by `inputHash` in a new `insights` table (purged with builds). Verdicts never approve, waive play failures, or override `409 baseline_changed`. MCP tools (`get_build_insight`, `get_project_health`) and the `insight:ready` notifier digest (ADR 0024 catalog) consume the same seam.

### 6. API access (first-class `/api/v1`, no new auth machinery)

New `routers/insights.ts` (+ `insights.handlers.ts` past ~150 lines), `app.openapi` routes with `schemas.ts` entries so insights land in `openapi.json` (website docs + type-safe CLI/MCP clients). No DELETE — rows die with builds via retention purge. No SSE in v1 — cache-hit-200 else 202 + poll matches the upload→202→queue async pattern.

| Method | Route | Roles | Behavior |
|---|---|---|---|
| `GET` | `/projects/:id/builds/:buildId/insights/latest` | `VIEW_ROLES` (all four) | Cached triage; `404 never-generated` with creation hint |
| `GET` | `/projects/:id/builds/:buildId/insights` | `VIEW_ROLES` | Bounded history list (`?limit`) |
| `POST` | `/projects/:id/builds/:buildId/insights` | `["approver", "admin"]` | `{ task?, profile?, force? }` → `inputHash` hit returns 200 unbilled; else budget pre-check (429 + `Retry-After`) → 202 with `Location` |
| `GET` | `/projects/:id/insights/health?window=30d` | `VIEW_ROLES` | Cached digest; `404` + refresh hint |
| `POST` | `/projects/:id/insights/health` | `["approver", "admin"]` | `{ window? }` → 202 background run |

Roles are **exact-match lists, not hierarchy** (`requireRole`/`assertRole` use `includes` — there is no "developer+"; approver is excluded from regenerate deliberately, per the ADR 0010 approver/developer split: regeneration spends shared budget and shapes review, so it sits with the merge-green-light role; loosening later is one line). Session and Bearer paths share the existing `helpers.ts` resolution (legacy ownerless tokens ⇒ viewer: reads yes, regenerate 403; cross-project tokens ⇒ scoped 404; site admin bypass unchanged). Guard order: no adapter ⇒ `501 ai-disabled`; `ai_profile IS NULL` ⇒ `409 ai-disabled-for-project`; role; budget; isolated rate-limit bucket. Fallbacks are envelope fields (`profileRequested`/`profileEffective`/`warnings[]`, `visionSkipped`, `usage.estimated`), never prose. Isolated rate-limit bucket (same pattern as the `auth:`/`engine:` buckets).

### 7. Layout (per `adapter-layout`)

`packages/ai/src/`: `types.ts` (options/slots only), `client.ts` (slot resolution + validation, `resolveSlot` normalizer), `codec.ts` (evidence → messages, `generateObject` + one schema-repair retry), `operations.ts` (`summarize` + budget guards), `lifecycle.ts` (`setup/health/teardown`; health probes, no inference), `index.ts` (factory first, re-exports bottom). Exports map frozen at `"."`; future subpaths need owner approval.

### 8. Observability (OTEL, per ADR 0022 — no new wiring)

`@storyshelf/ai` depends on `@opentelemetry/api` only (zero-dep shim, cross-runtime like the observability root) and never imports `@storyshelf/observability` — the §5 no-cycle rule applies unchanged, so the `withSpan`/propagation helper gets its intentional copy inside `ai` (do not deduplicate). The existing `initObservabilityFromEnv()` + `otelLogMixin` preamble in `dev-server`/`fly-app`/templates covers `ai` with no changes; behavior noops identically when OTEL is off, and tests use the in-memory exporter precedent.

- Spans: one `ai.summarize` root per call (nests under the request's `http.server` span for on-demand triage; fresh root per scheduled health run, same as retention-timer jobs), with children `ai.build_context` (evidence assembly) and `ai.inference` (the `generateObject` call; token counts as attributes, fallback markers as events). Attributes carry only `ai.task`, `ai.profile` (bounded admin-configured names), `ai.model` — never prompts, screenshots, story/build IDs, or secrets.
- Metrics (bounded cardinality, §7 precedent): `ai.inference.duration` and `ai.inference.tokens` histograms (attr `ai.task` + outcome only — model/profile stay on spans and DB rows), `ai.insights.completed`/`failed` counters. No per-story, per-build, or per-profile series.
- Logs: free via the host-owned logger (`setLogger`) + existing mixin (`trace_id`/`span_id`); log task/profile/model/outcome/usage, never evidence.
- Vercel SDK self-telemetry is enabled with `functionId: storyshelf-{task}` but `recordInputs: false, recordOutputs: false` — screenshots and prompts must never enter the trace backend (same rule as §7's path exclusion, extended to evidence). Operator docs gain an `ai.*` span/metric row in `docs/observability.md`.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| Bundle `@ai-sdk/*` in our deps | Version churn + key ownership in the wrong place; deployer-supplied instances remove both |
| TanStack AI | Client-oriented, immature provider ecosystem for server structured-output + multimodal |
| Raw `httpJson` to provider REST | Re-owns envelopes, tool-calling, multimodal parts, provider drift |
| SDK in `core` | Violates domain-only barrel + no-cycle rule |
| `insights` key / `insights_enabled` / `ai_allow_images` / JSON column | Subsumed: `ai` property, `ai_profile` tri-state, profiles-as-privacy-boundary, flat columns for three dialects |
| `createProfile`/`createProfiles` helpers | Unjustified surface; generics + in-factory validation cover it (same lesson as the auth-adapter collapse) |
| Per-profile budgets / per-project model picks | Chargeback without billing; enforce globally, observe per-profile, refine on dashboard evidence |
| Auto-approve from verdicts | Breaks human-gate invariant (ADR 0010 roles, ADR 0017 no-waive) |

## Consequences

**Positive:**
- Smallest valid deployment is one line (`profiles: { default: { defaultModel } }`); every refinement (vision model, second profile, caps) is additive, never a rewrite; misconfiguration fails at compile time where types reach, at creation otherwise, and degrades with markers at runtime — never silently.
- Self-hosted differentiator preserved: local default, data stays in VPC, unlimited agent iteration with no per-snapshot tax.
- Feature #2+ (summaries, fix suggestions) adds consumers and task keys only — no contract, schema, or package changes.

**Negative:**
- New runtime dep (`ai` core) to track for npm/JSR publish (LICENSE/README/deno.json checklist).
- Peer-major alignment between our `ai` core and user-installed `@ai-sdk/*` must be documented/pinned with a startup smoke check.
- `insights` table joins retention/purge surface.

## Links

- `packages/core/src/adapters/capture-runner.ts` — interface-in-core / implementation-in-package precedent
- `packages/core/src/adapters/notifier/provider.ts` — descriptor + runtime split precedent
- `docs/adr/0017-interaction-testing-via-play-function.md` — advisory-only / no-waive rule
- `docs/adr/0019-shared-http-helper.md` — outbound discipline; domain-SDK exception
- `docs/adr/0022-opentelemetry-observability.md` — single-owner + no-cycle precedent
- `docs/adr/0024-notification-adapters.md` — `insight:ready` digest event home
