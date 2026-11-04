---
"@storyshelf/core": patch
"@storyshelf/db-sqlite": patch
"@storyshelf/db-postgres": patch
"@storyshelf/db-mysql": patch
---

A unique index that existing rows already violate no longer goes unnoticed. The design-link index is still left out so an upgrade boots, but the database now logs one `error` with the table, the index, the number of repeated keys and how to fix it (never a row), and tries to create the index again on every boot. MySQL now skips that one duplicate-entry error for this index too, instead of failing the boot.
