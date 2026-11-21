---
"@storyshelf/db": minor
"storyshelf": minor
---

Breaking: @storyshelf/db-sqlite, -postgres and -mysql are now @storyshelf/db/sqlite, /postgres and /mysql

The three database adapters are one package, `@storyshelf/db`, with the subpaths `/sqlite`, `/postgres` and `/mysql`, and the presets under each: `/sqlite/turso`, `/sqlite/better-sqlite3`, `/sqlite/bun-sqlite`, `/sqlite/d1`, `/postgres/pg`, `/postgres/neon`, `/postgres/neon-http`, `/postgres/vercel`, `/postgres/pglite`, `/postgres/rds-iam`, `/mysql/planetscale` and `/mysql/tidb`. Factories, options and stored data are unchanged. Every driver is now an optional peer that only its own subpath loads (`postgres`, `mysql2`, `pg`, `@neondatabase/serverless`, `@vercel/postgres`, `@electric-sql/pglite`, `@aws-sdk/rds-signer`, `@planetscale/database`, `@tidbcloud/serverless`, `@libsql/client` and `better-sqlite3`), so install the one you use; `node:sqlite` still needs nothing. The `./ddl`, `./schema` and `./drizzle-factory` subpaths are no longer published. Nothing old is kept: `@storyshelf/db-sqlite`, `@storyshelf/db-postgres` and `@storyshelf/db-mysql` are not published again, so change your dependency and imports (see the upgrading guide). `server init` scaffolds `@storyshelf/db` and the driver. Schema: none.
