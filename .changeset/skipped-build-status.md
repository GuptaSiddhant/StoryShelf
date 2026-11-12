---
"@storyshelf/core": minor
"@storyshelf/db-sqlite": minor
"@storyshelf/db-postgres": minor
"@storyshelf/db-mysql": minor
---

Added: a `skipped` build status for commits that change no story (ADR 0044, groundwork)

A skipped build repeats the outcome of a source build and has no upload, snapshots or job. `skipped` is an entry-only terminal state in the build lifecycle table: no write moves a build to or from it, it is not cancellable and never resumed, and `hasApprovedBuildForSha` does not count it as approved. `builds.skipped_from_build_id` (nullable, indexed) is added to SQLite, Postgres and MySQL, with migrations for existing databases. `BuildModel` gains `createSkipped`, `skippedFrom` and `skipSourceOf`. `statusesForBuild` gives a skipped build its source's current outcome ("No story changed since <sha>"), links the source's Storybook only while it is available, and writes a one-line comment that links both builds. Nothing creates a skipped build yet; the endpoints and CLI flag follow.
