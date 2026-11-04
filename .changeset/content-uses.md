---
"@storyshelf/core": minor
"@storyshelf/db-sqlite": minor
"@storyshelf/db-postgres": minor
"@storyshelf/db-mysql": minor
"@storyshelf/app": patch
---

Changed: shared Storybook content is now tracked as per-build uses instead of a counter. A new `content_uses` table holds one row per (build, hash), written idempotently by both upload paths (`persistStorybookStatics` and the file-by-file manifest route) through `BuildReferenceLifecycle.recordContentUses`; a build that uses one hash at several paths has one row. The unused `content_refs` table, which never held rows on a real adapter, is dropped on startup (`db.tables.contentRefs` and `ContentRefModel` are replaced by `db.tables.contentUses`), and its error-swallowing counters are removed. Content collection claims a blob in the capability's concurrency domain (`claimContent` under a per-pass token, `holdsContentClaim`, `abandonContentClaim`, `finishContentCollection`), so a use racing a delete ends in exactly one outcome: the manifest route answers 409 and the publish job retries when a blob was claimed first. Custom adapters that implement `BuildReferenceLifecycle` must add the five new methods. No built-in adapter exposes the capability yet, so nothing is recorded or collected until SQLite activation (#536).
