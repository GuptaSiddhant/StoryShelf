---
"@storyshelf/db-sqlite": patch
"@storyshelf/db-postgres": patch
"@storyshelf/db-mysql": patch
---

An upgrade that meets a build_reviews table or a review column made outside StoryShelf (a missing column, or a type that cannot hold the setting) now stops with an error naming the table and column, instead of a raw driver error or a silent skip.
