---
"@storyshelf/db-sqlite": minor
"@storyshelf/app": minor
"@storyshelf/core": minor
"@storyshelf/observability": patch
---

Added: build retention now works on SQLite deployments with `testing`. When the schema is migrated at boot, the SQLite adapter prepares the baseline pins once and then exposes the `buildReferenceLifecycle` capability, so `POST /api/v1/admin/purge` and the daily branch GC run in a testing deployment (a baseline's source build is never purged) instead of answering `503`. The purge response gains `protected` (builds a baseline still needs) and `resumed` (builds an earlier interrupted run had claimed). If a baseline's recorded source build is being deleted or belongs to another project, retention stays off, the server logs the baseline and build ids once, and the System page shows "Retention is paused" until the data is fixed and the server restarted. In-memory SQLite and Postgres/MySQL keep refusing to purge with `testing`. `DatabaseAdapter` gains the optional `retentionPause`, which the observability wrapper forwards.
