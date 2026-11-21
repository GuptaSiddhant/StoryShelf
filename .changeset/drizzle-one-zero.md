---
"@storyshelf/core": minor
"@storyshelf/db-sqlite": minor
"@storyshelf/db-postgres": minor
"@storyshelf/db-mysql": minor
---

Changed: the database adapters run on Drizzle ORM 1.0 (1.0.0-rc.6)

`@storyshelf/core`, `@storyshelf/db-sqlite`, `@storyshelf/db-postgres` and `@storyshelf/db-mysql` depend on `drizzle-orm` 1.0.0-rc.6 instead of 0.45. Query results, list paging and the schema are unchanged. Code that implements its own `DatabaseAdapter`, or passes Drizzle `SQL` and tables into one, needs Drizzle 1.0 as well. The undocumented `createCallback` export of `@storyshelf/db-sqlite` is removed; `BUSY_WAIT_MS` stays. postgres.js stays on 3.4.

Schema: none.
