---
"@storyshelf/core": patch
"@storyshelf/db-sqlite": patch
"@storyshelf/db-postgres": patch
"@storyshelf/db-mysql": patch
---

Fixed: list queries return rows in the same order on every database

`DatabaseAdapter.list` now orders by `id` when no `orderBy` is given, and appends `id` as the final tie-break to any `orderBy`, so equal sort keys no longer come back in a database-chosen order.
