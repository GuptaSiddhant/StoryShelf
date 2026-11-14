---
"@storyshelf/core": minor
"@storyshelf/db-sqlite": minor
"@storyshelf/db-postgres": minor
"@storyshelf/db-mysql": minor
---

Internal: record the size of each published blob and sum a project's live content in one query (#875)

Schema: expand-only (ADR 0053). Adds the nullable column `content_uses.size_bytes` (`INTEGER` in SQLite, `BIGINT` in Postgres and MySQL); nothing is dropped or altered, and the previous release ignores it. Rows recorded before this release stay null; no backfill job runs.

`recordContentUses` takes the byte size of each blob when a build is published, and the new `BuildReferenceLifecycle.contentUsage(projectId)` returns the summed size of the project's live blobs (each counted once) plus how many have no recorded size. It never lists or reads storage. The Insights tab reads it in a later change.
