# StoryShelf — Task Board

> Structured task list for remaining P0–P4 improvements. Each task is self-contained with context, files, and acceptance criteria so any agent can pick it up.

---

## P0 — Critical (Complete)

| ID | Task | Status | Files |
|----|------|--------|-------|
| P0-1 | Type-safe API contracts (OpenAPI from Zod) | Done | `packages/core/src/routers/schemas.ts`, `packages/core/src/routers/openapi.test.ts` |
| P0-2 | Capture pipeline integration tests | Done | `packages/core/src/capture/integration.test.ts` |
| P0-3 | Retention purge integration tests | Done | `packages/core/src/retention/integration.test.ts` |

---

## P1 — High Priority (Not Started)

### P1-1: Query Performance Indexes

**Problem:** Several operations do linear scans that scale poorly at 1000+ builds/projects.

**Context:** Baseline resolution in `pipeline.ts:81-84`, comment listing, and build listing lack database indexes.

**Solution:** Add indexes on frequently-filtered columns in adapter migrations or schema.

**SQL to Add:**
```sql
CREATE INDEX IF NOT EXISTS idx_snapshots_build_id ON snapshots(build_id);
CREATE INDEX IF NOT EXISTS idx_comments_build_id ON comments(build_id);
CREATE INDEX IF NOT EXISTS idx_builds_git_branch ON builds(git_branch);
CREATE INDEX IF NOT EXISTS idx_baselines_project_story ON baselines(project_id, story_id);
```

**Files to Modify:**
- `packages/core/src/schema.ts` — add index definitions to Drizzle schema
- `packages/db-sqlite/src/index.ts` — add migration
- `packages/db-turso/src/index.ts` — add migration

**Acceptance Criteria:**
- [ ] Indexes defined in Drizzle schema
- [ ] Migrations generated and applied
- [ ] Existing tests still pass
- [ ] New test verifying query performance improvement

**Estimated Effort:** 1 day

---

### P1-2: Security Hardening

**Problem:** No XSS prevention in HTMX-rendered content, no rate limiting on sensitive endpoints, no CSRF protection, tokens not hashed at rest.

**Context:** Current state documented in `docs/DECISIONS.md`. Security gaps identified in staff review.

**Solution:**
1. Sanitize all API parameters (Zod schemas provide some validation)
2. Add rate limiting middleware
3. Add CSRF tokens for HTMX forms (`hx-post` with `X-CSRF-Token` header)
4. Hash API tokens at rest (SHA-256)

**Files to Modify:**
- `packages/core/src/middleware/` — add rate limiting, CSRF
- Update Zod schemas with stricter validation
- `packages/core/src/models/token.ts` — hash tokens on creation
- `packages/core/src/routers/ui.ts` — add CSRF to HTMX forms

**Acceptance Criteria:**
- [ ] Rate limiting on purge, admin, and auth endpoints
- [ ] CSRF tokens on all state-changing HTMX forms
- [ ] Tokens hashed at rest (SHA-256)
- [ ] XSS prevention in rendered content
- [ ] Tests for security behaviors

**Estimated Effort:** 2–3 days

---

### P1-3: Build Auto-Approval Guard (Verify Fix)

**Problem:** Builds auto-approved when `changedCount === 0` even with no captures.

**Context:** Fixed in commit `dcb831ab` by adding `hasCaptures = storyIds.size > 0` guard in `pipeline.ts`.

**Action:** Verify fix is complete and add edge-case tests.

**Files to Check:**
- `packages/core/src/capture/pipeline.ts` — verify fix
- `packages/core/src/capture/pipeline.test.ts` — add edge cases

**Acceptance Criteria:**
- [ ] Builds stay in `reviewing` when no captures occurred
- [ ] Builds with captures but no changes are approved
- [ ] Builds with failed renders are marked `failed`

**Estimated Effort:** 0.5 days

---

## P2 — Medium Priority (Not Started)

### P2-1: Configuration Validation (Zod at Startup)

**Problem:** `ShelfConfig` has optional fields validated at runtime only; misconfigurations discovered late.

**Solution:** Use Zod to validate `ShelfConfig` at startup with clear error messages.

**Files to Modify:**
- `packages/core/src/config.ts` — add Zod schema
- `packages/core/src/index.tsx` — validate on `createShelfRouter` entry

**Acceptance Criteria:**
- [ ] Zod schema validates `ShelfConfig` at startup
- [ ] Clear error messages for misconfigurations
- [ ] Existing tests still pass

**Estimated Effort:** 1 day

---

### P2-2: Baseline Change Alerting

**Problem:** Baselines auto-update on approval, but no notification system.

**Solution:** Add webhook events for `baseline:created`/`baseline:updated`, or add email notifications.

**Files to Modify:**
- `packages/core/src/adapters/webhook.ts` — add baseline events
- `packages/core/src/models/baseline.ts` — emit events on upsert

**Acceptance Criteria:**
- [ ] Webhook events emitted on baseline create/update
- [ ] Events include project, story, and viewport info
- [ ] Tests for event emission

**Estimated Effort:** 1–2 days

---

### P2-3: Label-Driven Build Resolution Tests

**Problem:** Label system for build types is implemented but lacks integration tests.

**Solution:** Add tests for label creation, assignment, and build resolution via labels.

**Files to Create:**
- `packages/core/src/routers/labels.integration.test.ts`

**Acceptance Criteria:**
- [ ] Label CRUD operations tested
- [ ] Build label assignment tested
- [ ] Build resolution by label tested
- [ ] Public access via public branch regex tested

**Estimated Effort:** 1 day

---

### P2-4: Branch Baseline Fallback Tests

**Problem:** Baseline resolution with branch fallback to default branch lacks integration tests.

**Solution:** Add tests for baseline resolution across branches and fallback behavior.

**Files to Create:**
- `packages/core/src/capture/baseline.integration.test.ts`

**Acceptance Criteria:**
- [ ] Baseline resolution for same branch works
- [ ] Fallback to default branch works
- [ ] No baseline case handled correctly

**Estimated Effort:** 1 day

---

## P3 — Low Priority (Not Started)

### P3-1: Capture Queue Interface Finalization

**Problem:** `CaptureQueue` interface has sync/async ambiguity documented as architectural debt.

**Solution:** Finalize interface split:
- `InMemoryCaptureQueue` — synchronous in-process (current implementation)
- `RemoteCaptureQueue` — asynchronous with `Promise<T>` for status/active/recent

**Files to Modify:**
- `packages/core/src/adapters/capture-queue.ts` — split interface
- Update `InMemoryCaptureQueue` to match new sync contract
- Create skeleton `RemoteCaptureQueue` adapter

**Acceptance Criteria:**
- [ ] Clear interface separation between sync and async queues
- [ ] `InMemoryCaptureQueue` implements sync contract
- [ ] `RemoteCaptureQueue` skeleton created
- [ ] Existing tests still pass

**Estimated Effort:** 2 days

---

### P3-2: Dependency Vulnerability Scanning

**Problem:** No automated vulnerability scanning in CI.

**Solution:** Add `npm audit` or `dependency-check` to the CI pipeline.

**Files to Modify:**
- `turbo.json` — add audit step
- Or add `dependency-check` to the build workflow

**Acceptance Criteria:**
- [ ] Audit step runs in CI
- [ ] Failures block merge
- [ ] Weekly scan scheduled

**Estimated Effort:** 1 day

---

### P3-3: Comment Model Project Validation

**Problem:** `CommentModel.create` references `projects` variable that may not be in scope in all contexts.

**Context:** Fixed in commit `dcb831ab` but may need verification.

**Action:** Verify project validation works and add tests.

**Files to Check:**
- `packages/core/src/models/comment.ts` — verify project validation
- `packages/core/src/models/comment.test.ts` — add edge cases

**Acceptance Criteria:**
- [ ] Comment creation validates project exists
- [ ] Error thrown for missing project
- [ ] Tests cover all edge cases

**Estimated Effort:** 0.5 days

---

## P4 — Future / Nice-to-Have

### P4-1: E2E Test Suite (Browser-Based)

**Problem:** No browser-based E2E tests for the capture pipeline.

**Solution:** Add Playwright tests for the full capture flow with real browser rendering.

**Files to Create:**
- `tests/e2e/capture.spec.ts`
- `tests/e2e/review.spec.ts`

**Acceptance Criteria:**
- [ ] Storybook upload works
- [ ] Capture produces screenshots
- [ ] Diff comparison works
- [ ] Review workflow works

**Estimated Effort:** 5–7 days

---

### P4-2: Performance Monitoring

**Problem:** No performance monitoring for capture pipeline.

**Solution:** Add metrics for capture duration, diff time, and storage operations.

**Files to Modify:**
- `packages/core/src/capture/orchestrator.ts` — add timing metrics
- `packages/core/src/capture/pipeline.ts` — add diff timing

**Acceptance Criteria:**
- [ ] Capture duration tracked
- [ ] Diff time tracked
- [ ] Storage operations tracked
- [ ] Metrics available via API

**Estimated Effort:** 2–3 days

---

### P4-3: Webhook Event System

**Problem:** No event system for build status changes.

**Solution:** Add webhook events for build created, capture started, capture completed, build approved/rejected.

**Files to Modify:**
- `packages/core/src/adapters/webhook.ts` — add event types
- `packages/core/src/routers/builds.ts` — emit events

**Acceptance Criteria:**
- [ ] Events emitted for all build status changes
- [ ] Events include relevant context
- [ ] Webhook delivery tested

**Estimated Effort:** 3–4 days

---

## How to Pick Up a Task

1. **Read this file** to find an uncompleted task
2. **Read `docs/architectural-improvement-plan.md`** for full context
3. **Read `docs/adr/`** for architectural decisions
4. **Run `nubx turbo test --filter='@storyshelf/core'`** to verify current state
5. **Create a task branch** from `main`
6. **Implement the task** following project conventions
7. **Add tests** (per the project's testing conventions)
8. **Submit PR** with clear description of what problem is solved
9. **Update this file** with progress and decisions

---

## Task Status Legend

| Status | Meaning |
|--------|---------|
| Done | Completed and merged |
| In Progress | Being worked on |
| Not Started | Ready to pick up |
| Blocked | Waiting on dependency |
| Deferred | Postponed to future |

---

*Last updated: 2026-08-31. See `docs/architectural-improvement-plan.md` for full architectural context.*
