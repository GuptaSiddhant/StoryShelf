# Baseline writer inventory

This inventory tracks issue #373. Lifecycle-aware deletion remains disabled until the writer and
cleanup work is complete. Existing tests listed here do not by themselves prove cross-process safety.

| Path | Mutation | Current coverage and remaining work |
| --- | --- | --- |
| `app/src/routers/builds.handlers.ts` `approveSnapshot` | Review decision and promotion | `app/src/routers/baseline-guard.integration.test.ts` covers drift responses. Drift check, review write and promotion still require one lifecycle transaction and independent-connection contention tests. |
| `core/src/capture/pipeline.ts` | Default-branch auto-accept and environment migration call `BaselineModel.upsert` | `core/src/capture/pipeline-environment.test.ts` covers migration behavior; lifecycle concurrency and source/reference atomicity need integration coverage. |
| `core/src/capture/pipeline.ts` | Legacy fingerprint backfill calls `BaselineModel.backfillFingerprint` | SQLite lifecycle test covers rejection after a concurrent baseline change; unsupported adapters retain existing behavior while purge is disabled. |
| `core/src/models/baseline.ts` `upsert` | Explicit promotion and replacement | Fenced lifecycle transaction checks source snapshot and existing baseline. `core/src/models/baseline-atomic.test.ts` and SQLite lifecycle tests cover the primitive; approval drift must be checked in that same transaction. |
| `core/src/models/baseline-transfer.ts` `import` | Archive replacement or insertion | Fenced multi-owner replacement and transaction identity checks. `core/src/models/baseline-transfer.test.ts` and SQLite lifecycle tests cover import behavior; concurrent identity creation and replacement need further coverage. |
| `core/src/models/baseline.ts` `removeOrphans`, `removeForBranch`, `removeStaleBranches` | Orphan and stale-branch baseline deletion | Fenced reference release and row removal. `core/src/models/baseline.test.ts` and SQLite lifecycle tests cover branch behavior and shared owners; concurrent promotion and cleanup need further coverage. |
| `db-sqlite/src/build-reference-lifecycle.ts` `prepareBaselineReferences` | Prepare pins for existing known sources | SQLite lifecycle tests cover repeated preparation, missing sources and two baselines sharing a source. Restart/interruption and coordination with all writers require additional coverage before activation. |

Historical comparison images stay with their consuming snapshot and do not create build references.
Unknown provenance does not establish a source-build pin. Hosting-only retention behavior is separate.
