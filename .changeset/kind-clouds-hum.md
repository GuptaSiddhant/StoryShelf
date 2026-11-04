---
"@storyshelf/db-sqlite": patch
---

The review-schema check, which names the table and column of a build_reviews table or review column made outside StoryShelf, now also runs when better-sqlite3, bun:sqlite, D1 and Turso start, through one small table-info reader that works for sync and async clients.
