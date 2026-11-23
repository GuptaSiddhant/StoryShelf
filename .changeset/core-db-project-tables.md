---
"@storyshelf/core": patch
"@storyshelf/db": patch
---

Internal: define `projects` and its member, group-mapping and link tables as neutral tables

ADR 0041 task 3a, batch 2 (#1225). `projects`, `project_members`, `project_group_mappings` and
`project_links` are defined once in `@storyshelf/core/db`, with a new `double` column kind (`real`
in SQLite, `double precision` in Postgres, `double` in MySQL) for the two threshold columns. Each
table factory maps the new kind, and the generation-diff gate now builds every neutral table with no
hand-written table to reference: the generated DDL matches `ddl.ts` with no new difference. No
adapter uses the factories yet, so no schema or runtime behaviour changes.
