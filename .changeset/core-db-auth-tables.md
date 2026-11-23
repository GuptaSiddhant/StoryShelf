---
"@storyshelf/core": patch
---

Internal: define the Better Auth tables as neutral tables

ADR 0041 task 3a: `user`, `session`, `account`, `verification`, `passkey` and `ssoProvider` move to
`defineTable`, so every table is now a neutral table. Each dialect's table-factory test in
`@storyshelf/db` checks they generate the DDL of `ddl.ts`, and a new `@storyshelf/auth` test checks
its SQLite and Postgres tables infer the same rows. Nothing reads them yet.
