---
"@storyshelf/core": minor
"@storyshelf/db-sqlite": minor
---

Added: a resumable build-deletion driver for databases with the build lifecycle capability. A claimed build is finished in three recorded steps (release shared content, delete storage, remove rows), so a crash resumes at the first unfinished step and shared content is released exactly once per build. Purge uses it when the capability is present, and content collection now also keeps any blob a live build's manifest names. `BuildReferenceLifecycle` gains `listDeleting`, `releaseBuildContent`, `markStorageDeleted` and `completeDeletion` (custom adapters that implement the capability must add them). SQLite gains the `build_deletions` and `build_content_releases` tables, and `ContentRefModel.get` now finds a row by its `hash` column. No built-in adapter exposes the capability yet, so purge behavior is unchanged until SQLite activation (#536).
