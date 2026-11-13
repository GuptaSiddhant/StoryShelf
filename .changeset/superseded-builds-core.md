---
"@storyshelf/core": minor
"@storyshelf/db-sqlite": minor
"@storyshelf/db-postgres": minor
"@storyshelf/db-mysql": minor
---

Added: core support for cancelling superseded builds (ADR 0045, #759)

A project gets a `cancelSuperseded` setting, and `BuildModel.supersede` cancels the earlier builds of a branch that a newer commit replaces, recording the newer build in `builds.superseded_by_build_id`. A superseded build keeps the `cancelled` outcome and its commit status reads `Superseded by <short sha>`. Only builds still pending, capturing or comparing, with no verdict or comment, are ever cancelled this way. Nothing calls it yet: the upload route and CLI follow, so behaviour does not change until they land.

**Existing projects get the setting on.** The new column defaults to `true`, so every project upgraded to this release has it enabled.

Schema: expand only. Adds `projects.cancel_superseded` (boolean, NOT NULL, default true) and `builds.superseded_by_build_id` (nullable text) in every dialect; no backfill, and a previous release keeps working on the new schema.
