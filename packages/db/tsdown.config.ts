import { libConfig } from "../../config/tsdown.ts";

export default libConfig({
  "sqlite/index": "./src/sqlite/index.ts",
  "sqlite/better-sqlite3": "./src/sqlite/better-sqlite3.ts",
  "sqlite/bun-sqlite": "./src/sqlite/bun-sqlite.ts",
  "sqlite/d1": "./src/sqlite/d1.ts",
  "sqlite/turso": "./src/sqlite/turso.ts",
  "postgres/index": "./src/postgres/index.ts",
  "postgres/neon": "./src/postgres/neon.ts",
  "postgres/neon-http": "./src/postgres/neon-http.ts",
  "postgres/pg": "./src/postgres/pg.ts",
  "postgres/pglite": "./src/postgres/pglite.ts",
  "postgres/rds-iam": "./src/postgres/rds-iam.ts",
  "postgres/vercel": "./src/postgres/vercel.ts",
  "mysql/index": "./src/mysql/index.ts",
  "mysql/planetscale": "./src/mysql/planetscale.ts",
  "mysql/tidb": "./src/mysql/tidb.ts",
});
