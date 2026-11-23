---
"@storyshelf/core": patch
---

Internal: define the web push subscriptions table as a neutral table

ADR 0041 task 3a: `push_subscriptions` (ADR 0048, merged from `main`) moves to `defineTable`, so
all 46 tables are neutral tables. Each dialect's table-factory test checks it generates the DDL of
`ddl.ts` (MySQL's `VARCHAR(512)` endpoint included) and the row type of its Drizzle schema, and it
infers `PushSubscriptionRow` exactly. Nothing reads it yet.

Schema: none
