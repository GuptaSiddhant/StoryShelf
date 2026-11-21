---
"@storyshelf/core": minor
"@storyshelf/db-sqlite": minor
"@storyshelf/db-postgres": minor
"@storyshelf/db-mysql": minor
---

Internal: add the `@storyshelf/core/db` subpath and map `json<T>` columns in every table factory

ADR 0041 task 3a, part 1 (#1225). The neutral schema layer (`defineTable`, the logical column
types, the dialect kit and the tables defined so far) moves from `@storyshelf/core/test-helpers`
(`neutralSchema`) to its own subpath, and the three table factories import it from there.
`SPIKE_TABLES` is now `NEUTRAL_TABLES`. A `json<T>` column is `TEXT` in every dialect, written with
`JSON.stringify` and parsed on read, with its default set by `defaultJson`; on MySQL, which has no
literal default on `TEXT`, that default is applied by Drizzle on insert. No adapter uses the
factories yet, so no schema or runtime behaviour changes.
