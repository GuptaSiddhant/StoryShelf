---
"@storyshelf/core": patch
"@storyshelf/db": patch
---

Internal: define the design, insight, AI usage and git connection tables as neutral tables

ADR 0041 task 3a: `design_links`, `design_credentials`, `design_nodes`, `insights`, `ai_usage`,
`ai_budget_alerts`, `git_connections` and `git_repository_links` move to `defineTable`. Each
dialect's table-factory test checks they generate the DDL of `ddl.ts` and the row types of its
Drizzle schema. The MySQL factory applies a `text` column's default on insert, as it does for
`json<T>`, because MySQL gives `TEXT` no literal default. The DDL shape reader no longer takes a
column named `checked_at` or `uniqueness` for a table constraint. Nothing reads the tables yet.
