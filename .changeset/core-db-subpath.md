---
"@storyshelf/core": minor
"@storyshelf/db": minor
---

Internal: add the `@storyshelf/core/db` subpath and map `json<T>` columns in every table factory

ADR 0041 task 3a, part 1 (#1225). The neutral schema layer (`defineTable`, the logical column
types, the dialect kit and the tables defined so far) moves from `@storyshelf/core/test-helpers`
(`neutralSchema`) to its own subpath, and the three table factories import it from there.
`SPIKE_TABLES` is now `NEUTRAL_TABLES`. A `json<T>` column is `TEXT` in every dialect, written with
one serializer that refuses a value with no JSON form, and parsed on read. Its default is set by
`defaultJson` and applied on insert as the parsed value, so it is encoded once; on MySQL, which has
no literal default on `TEXT`, the DDL has none. No adapter uses the
factories yet, so no schema or runtime behaviour changes.
