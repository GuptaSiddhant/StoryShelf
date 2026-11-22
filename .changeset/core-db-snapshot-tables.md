---
"@storyshelf/core": patch
"@storyshelf/db": patch
---

Internal: define the snapshot, baseline and comment tables as neutral tables

ADR 0041 task 3a: `snapshots`, `baselines` and `comments` move to `defineTable`. Each dialect's
table-factory test checks they generate the DDL of `ddl.ts` and the row types of its Drizzle
schema. Nothing reads them yet.
