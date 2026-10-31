# Baseline writer inventory

This inventory tracks issue #373. Lifecycle-aware deletion remains disabled until the writer and
cleanup work is complete. Existing tests listed here do not by themselves prove cross-process safety.

| Path | Mutation | Transaction boundary and evidence |
| --- | --- | --- |
| `app/src/routers/builds.handlers.ts` `approveSnapshot` | Review decision and promotion | `app/src/routers/baseline-guard.integration.test.ts` covers drift responses. Lifecycle-aware approval uses `approveInTransaction` within promotion; SQLite lifecycle tests verify rollback on drift, forced approval and a contending deletion process. |
| `core/src/capture/pipeline.ts` | Default-branch auto-accept and environment migration call `BaselineModel.upsert` | `core/src/capture/pipeline-environment.test.ts` covers migration behavior; all promotion callers use the same fenced baseline transaction, whose SQLite contract and promotion tests verify atomic source references. |
| `core/src/capture/pipeline.ts` | Legacy fingerprint backfill calls `BaselineModel.backfillFingerprint` | SQLite lifecycle test covers rejection after a concurrent baseline change; unsupported adapters retain existing behavior while purge is disabled. |
| `core/src/models/baseline.ts` `upsert` | Explicit promotion and replacement | Fenced lifecycle transaction checks source snapshot and existing baseline. `core/src/models/baseline-atomic.test.ts` and SQLite lifecycle tests cover the primitive; approval drift is checked in that same transaction. |
| `core/src/models/baseline-transfer.ts` `import` | Archive replacement or insertion | Fenced multi-owner replacement and transaction identity checks. `core/src/models/baseline-transfer.test.ts` and SQLite lifecycle tests cover import behavior; database uniqueness rejects concurrent identity insertion, and the fenced transaction rechecks the planned identity/version/source before replacement. |
| `core/src/models/baseline.ts` `removeOrphans`, `removeForBranch`, `removeStaleBranches` | Orphan and stale-branch baseline deletion | Fenced reference release and row removal. `core/src/models/baseline.test.ts` and SQLite lifecycle tests cover branch behavior and shared owners; generation fencing rejects stale removal, while shared-owner tests verify release of the last pin. |
| `db-sqlite/src/build-reference-lifecycle.ts` `prepareBaselineReferences` | Prepare pins for existing known sources | SQLite lifecycle tests cover repeated preparation, missing sources and two baselines sharing a source. The process-kill test verifies rollback before commit and successful preparation after restart. Preparation holds the same SQLite write lock as the writers and deletion claims. Activation remains part of #374. |

Historical comparison images stay with their consuming snapshot and do not create build references.
Unknown provenance does not establish a source-build pin. Hosting-only retention behavior is separate.

## Deployment boundary

This work prepares lifecycle-aware baseline mutations for the SQLite file implementation. The
capability remains internal; neither production purge nor the background branch cleanup is enabled
for testing deployments here. Issue #374 owns cleanup recovery and activation. Other database
presets retain the existing fail-closed testing purge behavior. Hosting-only retention is unchanged.

Preparation runs in one SQLite write transaction and can be restarted. An interrupted process
leaves no partial source/reference/generation writes. Only provable sources are linked: inherited
images follow their recorded renderer; imported, missing or unprovable sources remain unknown.
Preparation cannot restore deleted builds. Reference generations survive release so older work
cannot remove a newer owner's pin. Historical frozen images remain with the consuming build.
