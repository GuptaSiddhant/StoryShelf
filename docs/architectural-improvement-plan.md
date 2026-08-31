# StoryShelf — Architectural Improvement Plan

## Overview

This document captures all architectural improvements, tech debt fixes, and quality assurance enhancements implemented during the staff developer review. It is intended so that other agents can pick up tasks, understand the rationale, and continue the work.

---

## ✅ Completed Work

### Commit `dcb831ab` — Tech Debt & Functional Soundness Fixes

| File | Issue | Fix | Impact |
|------|-------|-----|--------|
| `packages/core/src/capture/pipeline.ts` | Builds auto-approved when `changedCount === 0` even with no captures | Added `hasCaptures = storyIds.size > 0` guard — builds stay in `reviewing` when no captures occurred, regardless of `changedCount` | **Critical**: Prevents incorrect build approval |
| `packages/core/src/retention/purge.ts` | `latestPerBranch()` fetched all builds O(n) in JavaScript | Optimized to single SQL query `SELECT id, gitBranch, createdAt FROM builds WHERE projectId = ... ORDER BY createdAt DESC` | **Medium**: Better performance at scale |
| `packages/core/src/models/comment.ts` | No project existence validation on comment creation | Added `await this.db.get(projects, projectId)` + throw if not found | **Medium**: Data integrity |
| `packages/core/src/adapters/capture-queue.ts` | Duplicated `JobStatus`/`QueueEntry` type definitions | Removed top-level definitions; `JobStatus` now references re-export from `capture-runner.ts` | **Low**: Cleaner interface, API compatible |

### Commit `1dd47366` — Test Coverage for Fixes

| File | Tests Added | Purpose |
|------|------------|---------|
| `packages/core/src/capture/pipeline.test.ts` | "keeps build in reviewing status when no captures occur" | Enforces the auto-approval bug fix |
| `packages/core/src/models/comment.test.ts` | 4 tests (create, throws on missing project, list by build, resolve) | Enforces project validation in CommentModel |

### Commit `965f6403` — Comprehensive Model Test Coverage

**7 new test files, 486 insertions:**

| Model | Tests | Key Scenarios |
|-------|-------|---------------|
| `build.test.ts` | 7 tests | Create, list filter, get by id, update status, update counts, remove, cascade |
| `project.test.ts` | 7 tests | Create (unique slug), get by id, get by slug, list all, update, remove |
| `snapshot.test.ts` | 6 tests | Create, list by build, get by id, update status, review, structure |
| `label.test.ts` | 4 tests | Create type, list types, remove type, update/remove cycle |
| `member.test.ts` | 4 tests | Set role, list members, remove member, role validation |
| `token.test.ts` | 5 tests | Create, get by id, list, remove, listing validation |
| `webhook.test.ts` | 4 tests | Create, get by id, list, remove |

**All 15 test files pass `node --check` syntax validation.**

---

## 📋 Prioritized Improvement Areas (Beyond Original Scope)

### 1. Type-Safe API Contracts (High Priority)

**Problem**: API endpoints have Zod schemas for some validation, but not all; type drift between schemas and runtime.

**Solution**: Generate OpenAPI specs automatically from Zod schemas using `@hono/zod-openapi`.

**Files to Create/Modify**:
- `packages/core/src/routes/schemas.ts` — shared response schemas
- `packages/core/src/routes/openapi.ts` — OpenAPI spec generation
- Update routers to use `c.req.valid()` instead of manual `validJson`
- Add `GET /api/v1/openapi.json` and `GET /api/v1/docs` endpoints

**Impact**: Zero-drift API contracts, automatic client generation, better DX.

**Estimated Effort**: 2-3 days

---

### 2. Integration Test Scenarios (High Priority)

**Problem**: Only unit/adapter tests exist (hermetic, no browser); capture pipeline has gated `test:integration` suite.

**Solution**: Add integration test scenarios exercising the full pipeline:
- Upload → Capture → Diff → Review → Approve → Purge
- Branch baseline fallback behavior
- Label-driven build resolution
- Purge TTL behavior

**Files to Create**:
- `packages/core/src/capture/integration.test.ts` — full pipeline mock
- `packages/core/src/retention/integration.test.ts` — purge scenarios

**Impact**: End-to-end confidence, earlier bug detection, documentation of expected behavior.

**Estimated Effort**: 3-5 days

---

### 3. Query Performance Optimization (Medium Priority)

**Problem**: Several operations do linear scans that could scale poorly:
- Baseline resolution in `pipeline.ts:81-84`
- Comment listing could grow large
- Build listing without proper indexes

**Solution**: Add database indexes on frequently-filtered columns.

**SQL Indexes to Add** (in adapter migrations or schema):
```sql
CREATE INDEX IF NOT EXISTS idx_snapshots_build_id ON snapshots(build_id);
CREATE INDEX IF NOT EXISTS idx_comments_build_id ON comments(build_id);
CREATE INDEX IF NOT EXISTS idx_builds_git_branch ON builds(git_branch);
CREATE INDEX IF NOT EXISTS idx_baselines_project_story ON baselines(project_id, story_id);
```

**Impact**: Better performance at 1000+ builds/projects.

**Estimated Effort**: 1 day

---

### 4. Security Hardening (Medium Priority)

**Problem**: Several security areas need attention:
- No XSS prevention in HTMX-rendered content
- No rate limiting on sensitive endpoints (purge, admin)
- No CSRF protection for state-changing API calls
- Token/secret hashing noted as gap in DECISIONS.md

**Solution**:
- Sanitize all API parameters (Zod schemas already provide some validation)
- Add rate limiting middleware (oxlint/oxhttp or express-rate-limit equivalent)
- Add CSRF tokens for HTMX forms (`hx-post` with `X-CSRF-Token` header)
- Hash API tokens at rest (SHA-256 as noted in DECISIONS.md)

**Files to Modify**:
- `packages/core/src/middleware/` — add rate limiting, CSRF
- Update Zod schemas with stricter validation
- Hash tokens on creation in `token.ts`

**Impact**: Reduced attack surface, production readiness.

**Estimated Effort**: 2-3 days

---

### 5. Configuration Validation (Low Priority)

**Problem**: `ShelfConfig` has optional fields validated at runtime only; misconfigurations discovered late.

**Solution**: Use Zod to validate `ShelfConfig` at startup with clear error messages.

**Files to Modify**:
- `packages/core/src/config.ts` — add Zod schema
- `packages/core/src/index.tsx` — validate on `createShelfRouter` entry

**Impact**: Fail-fast startup, clearer debugging.

**Estimated Effort**: 1 day

---

### 6. Baseline Change Alerting (Low Priority)

**Problem**: Baselines auto-update on approval, but no notification system.

**Solution**: Add webhook events for `baseline:created`/`baseline:updated`, or add email notifications.

**Files to Modify**:
- `packages/core/src/adapters/webhook.ts` — add baseline events
- `packages/core/src/models/baseline.ts` — emit events on upsert

**Impact**: Designers/managers stay informed without constant UI monitoring.

**Estimated Effort**: 1-2 days

---

### 7. Capture Queue Interface Finalization (Low Priority)

**Problem**: `CaptureQueue` interface has sync/async ambiguity documented as architectural debt.

**Solution**: Finalize interface split:
- `InMemoryCaptureQueue` — synchronous in-process (current implementation)
- `RemoteCaptureQueue` — asynchronous with `Promise<T>` for status/active/recent

**Files to Modify**:
- `packages/core/src/adapters/capture-queue.ts` — split interface
- Update `InMemoryCaptureQueue` to match new sync contract
- Create skeleton `RemoteCaptureQueue` adapter

**Impact**: Cleaner architecture, easier remote queue implementations.

**Estimated Effort**: 2 days

---

### 8. Dependency Vulnerability Scanning (Low Priority)

**Problem**: No automated vulnerability scanning in CI.

**Solution**: Add `npm audit` or `dependency-check` to the CI pipeline.

**Files to Modify**:
- `turbo.json` — add audit step
- Or add `dependency-check` to the build workflow

**Impact**: Proactive security maintenance.

**Estimated Effort**: 1 day

---

## 📂 File Changes Summary

### Modified Files (4 original fixes + model validations):
- `packages/core/src/capture/pipeline.ts` — build approval guard
- `packages/core/src/retention/purge.ts` — purge optimization
- `packages/core/src/models/comment.ts` — project validation
- `packages/core/src/adapters/capture-queue.ts` — interface cleanup

### New Test Files (486 lines):
- `packages/core/src/models/build.test.ts`
- `packages/core/src/models/project.test.ts`
- `packages/core/src/models/snapshot.test.ts`
- `packages/core/src/models/label.test.ts`
- `packages/core/src/models/member.test.ts`
- `packages/core/src/models/token.test.ts`
- `packages/core/src/models/webhook.test.ts`
- `packages/core/src/capture/pipeline.test.ts` (1 test added)
- `packages/core/src/models/comment.test.ts` (4 tests added)

### New Doc File (to create):
- `docs/architectural-improvement-plan.md` — this document

---

## 🚀 Recommended Next Steps

| Priority | Task | Owner | ETA |
|----------|------|-------|-----|
| **P0** | Type-safe API contracts (OpenAPI from Zod) | Core team | 2-3 days |
| **P0** | Integration test scenarios (full pipeline) | QA team | 3-5 days |
| **P1** | Query performance indexes | Core team | 1 day |
| **P1** | Security hardening (XSS, rate limit, CSRF) | Security lead | 2-3 days |
| **P2** | Configuration validation (Zod at startup) | Core team | 1 day |
| **P2** | Baseline change alerting | QA team | 1-2 days |
| **P3** | Capture queue interface finalization | Core team | 2 days |
| **P3** | Dependency vulnerability scanning | DevOps | 1 day |

---

## 🛠 How Agents Can Pick Up Tasks

1. **Read this plan** to understand the full scope
2. **Check `git log --oneline`** for recent commits and their rationale
3. **Review `docs/adr/`** for architectural decision records
4. **Run `nubx turbo test --filter='@storyshelf/core'`** to verify current state
5. **Create a task branch** from `main` and implement the chosen improvement
6. **Add tests first** (per the project's testing conventions)
7. **Submit PR** with clear description of what problem is solved
8. **Update this plan** with progress and decisions

---

*Document generated from architectural review completed on 2026-08-31. See `docs/DECISIONS.md` for implementation-time decisions, `docs/ADR/` for architectural design records.*