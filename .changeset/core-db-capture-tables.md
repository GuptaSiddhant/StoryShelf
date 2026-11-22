---
"@storyshelf/core": patch
"@storyshelf/db-sqlite": patch
"@storyshelf/db-postgres": patch
"@storyshelf/db-mysql": patch
---

Internal: define the capture queue, attempt, log and shard tables as neutral tables

ADR 0041 task 3a, batch 4 (#1225). `capture_jobs`, `capture_attempts`, `capture_logs` and
`capture_shards` are defined once in `@storyshelf/core/db`, and the generation-diff gate covers
them with no new difference in any dialect. No adapter uses the factories yet, so no schema or
runtime behaviour changes.
