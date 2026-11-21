---
"@storyshelf/core": minor
---

Added: `readSchemaRelease` reads the release that last migrated the database

Exported from `@storyshelf/core/adapter/database`. It reads `schema_meta` without creating or changing anything, and returns `null` when nothing has migrated the database yet. `storyshelf-server doctor` reports it.

Schema: none.
