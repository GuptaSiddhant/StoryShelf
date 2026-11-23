---
"@storyshelf/core": patch
"@storyshelf/db": patch
---

Internal: define build reviews, components, package usage and content uses as neutral tables

ADR 0041 task 3a, batch 4: `build_reviews`, `build_components`, `build_package_usage` and
`content_uses` move to `defineTable`. Each adapter's table-factory test checks they generate the
DDL of `ddl.ts` and the row types of its Drizzle schema. Nothing reads them yet.
