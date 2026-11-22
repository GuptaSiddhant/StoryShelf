---
"@storyshelf/db": patch
---

Internal: mark users.email, projects.slug and tokens.hash unique in the Drizzle schemas

ADR 0041 task 3a: the three columns are `UNIQUE` in every dialect's `ddl.ts`, and always have been,
but no hand-written Drizzle schema said so (the drift ADR 0041 records). The Drizzle columns now
carry `.unique()`. No database changes: the constraint is the one the DDL already creates, and no
query reads the flag. Each table-factory test now fails when a neutral `unique()` column is not
unique in the hand-written schema.
