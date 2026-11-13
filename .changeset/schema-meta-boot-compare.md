---
"@storyshelf/app": minor
"@storyshelf/core": minor
"@storyshelf/db-sqlite": minor
"@storyshelf/db-postgres": minor
"@storyshelf/db-mysql": minor
---

Changed: the database records the release that last migrated it, and boot compares it (#983)

Schema: expand-only. Adds the one-row table `schema_meta` (`id`, `version`, `migrated_at`) in SQLite, Postgres and MySQL; a database without it counts as older, and nothing is dropped or altered.

At boot a copy compares its release with `schema_meta.version`, counting patch versions as their minor: an equal or older database is migrated and then records the running release; a database one minor newer skips migrations and starts (rolling back one minor is safe); a database more than one minor newer refuses to start and names both releases. A run from source reports no release, so it migrates and records nothing (ADR 0053, decision 2).
