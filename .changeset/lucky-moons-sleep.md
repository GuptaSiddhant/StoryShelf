---
"@storyshelf/db-sqlite": patch
"@storyshelf/db-postgres": patch
"@storyshelf/db-mysql": patch
---

An upgrade that meets a build_reviews table or a review column made outside StoryShelf (a missing column, or a type that cannot hold the setting) now stops with an error naming the table and column, instead of a raw driver error or a silent skip. On SQLite this covers the default `node:sqlite` driver; the `better-sqlite3`, `bun:sqlite`, D1 and Turso drivers keep their previous behavior.
