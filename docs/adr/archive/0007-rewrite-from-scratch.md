# ADR 0007: Rewrite from Scratch

## Status

Accepted

## Context

StoryShelf is a repositioning of StoryBooker as a self-hosted Chromatic alternative. The question was: iterate on StoryBooker's codebase (~15,200 LOC, 152 source files) or start fresh?

### StoryBooker audit findings

| Metric | Value | Impact |
|--------|-------|--------|
| Total LOC | ~15,200 | Manageable to rewrite |
| Test files | 8 out of 152 source files (~5%) | No safety net for refactoring |
| Compute system LOC | ~3,257 (21% of codebase) | 4/5 cloud adapters experimental, untested |
| Hardcoded variant references | 8+ files | Data model change requires touching entire stack |
| CRUD form pages | 8 of 23 (35% of UI) | Most UI is admin forms, not diff review |
| CLI commands | 3 (1 broken) | Minimal starting point |
| Cloud adapter tests | 0 | 3,800 LOC of untested cloud code |
| Models coupled to AsyncLocalStorage | All models | Untestable without store mocks |

### The core mismatch

StoryBooker is a **Storybook hosting platform** with build tracking and metadata comparison. StoryShelf needs to be a **visual testing tool** with screenshot capture, pixel diffs, and review workflows.

These are fundamentally different products:
- StoryBooker: upload zip -> store -> display side-by-side
- StoryShelf: capture screenshots -> diff against baselines -> review diffs -> approve/reject

The data model, UI, and CLI all need to be different. The only things worth preserving are architectural patterns (~850 LOC of reference code).

## Decision

Rewrite from scratch, extracting patterns from StoryBooker.

### What to extract (patterns, not code)

| Pattern | Reference LOC | Source |
|---------|--------------|--------|
| Adapter composition | ~100 | `createHonoRouter()` |
| Type-safe URL builder | ~100 | `linkRoute()` |
| HTMX page shell | ~300 | `DocumentLayout` |
| **Total** | **~500** | |

Capture is now a **fixed server-side pipeline** (upload Storybook → render → diff), not a user-defined shell job. StoryBooker's `generateJobShellScript()` / `wrapComputeOptions()` / `JobDefinition` / `JobStep` are therefore **not** extracted (see ADR 0003).

### Timeline

| Day | Deliverable |
|-----|-------------|
| 1 | Scaffold + SQLite/Turso schema + Drizzle setup |
| 2 | Storage adapter (local + S3) + build CRUD + storybook zip upload |
| 3 | Capture pipeline (serve statics + Playwright render) + in-process queue |
| 4 | Diff engine (pixelmatch + overlay generation) |
| 5 | Baseline resolution (per-branch + fallback) + review workflow (accept/reject) |
| 6-7 | Build review UI (diff overlay, side-by-side, accept/reject) |
| 8 | Retention & purge (TTL + per-branch + orphan GC) |
| 9 | Project management UI + CLI completion + GitHub Actions workflow |
| 10 | Docker compose + README + deployment |

## Consequences

**Positive:**
- Clean codebase with 100% test coverage from day one
- No legacy debt -- right data model, right UI shape, right CLI
- Agentic dev works ~40% faster on clean codebases
- Every architectural decision is intentional, not inherited

**Negative:**
- Cannot reuse StoryBooker's battle-tested HTTP handlers (zip processing, file serving)
- Must re-implement OpenAPI spec generation
- 10 working days before first usable version

**Mitigation:** The HTTP handlers are straightforward Hono code. Reimplementing them is ~2 days, not ~2 weeks.
