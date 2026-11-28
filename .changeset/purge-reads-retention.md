---
"@storyshelf/core": patch
"@storyshelf/db": patch
"@storyshelf/app": patch
---

Fixed: storyshelf-server purge works on every database

`storyshelf-server purge` loads the instance as a `tool`, which never migrates, so the database never exposed its fenced retention and the route answered 503 on SQLite, Postgres and MySQL alike. `DatabaseAdapter` gains an optional `activateRetentionReadOnly`: when the schema was migrated by this release (or one minor newer) and the baseline pins are prepared, it exposes the existing fenced lifecycle from reads alone, with no migration, no `schema_meta` write and no pin preparation. Otherwise `purge` prints one line, `Build retention is not prepared…` or `…is paused…`, that names the fix (run `storyshelf-server serve` or `migrate` once) and exits 1; a refused admin call now prints the API's error message instead of its JSON. Schema: none.
