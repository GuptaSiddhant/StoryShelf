---
"@storyshelf/app": minor
"@storyshelf/core": minor
"storyshelf": minor
---

Added: skipped builds check `entryIds`, take an `idempotencyKey` and `labels` (ADR 0044)

`POST /api/v1/projects/:slug/builds/skipped` now requires the new index's `entryIds` and `idempotencyKey`, and takes `labels`. It answers `409` unless `entryIds` equal the source build's catalog, so an added, renamed or deleted story always uploads. A repeated `idempotencyKey` answers `200` with the build it already created. `labels` are validated and attached exactly as on normal build creation, `persistent` included. Normal build creation inserts the build and replaces the skipped builds of the same project, branch and commit (setting their `superseded_by_build_id`) in one transaction, and a repeated `idempotencyKey` finishes the label attach and announcement a failure after the insert left undone. `storyshelf upload --skip-unchanged` sends `entryIds` (read from the built Storybook's index), one `idempotencyKey` per run (retried up to three times after a network failure) and the parsed `--label` values, so it no longer uploads normally just because a label is given or a story file was removed. The route is still behind `skippedBuilds`, which is off by default, so no released client sends the old shape.

Schema: `builds.superseded_by_build_id` (nullable text) and `builds.idempotency_key` (nullable text) with a unique index `builds_project_idempotency_idx` on `(project_id, idempotency_key)`, in the SQLite, Postgres and MySQL DDL, Drizzle schemas and migrations, plus the `Build` row type. Expand step: both columns are new in this release, so the unique index is allowed (ADR 0053).
