import { libConfig } from "../../config/tsdown.ts";

export default libConfig({
  index: "./src/index.ts",
  turso: "./src/turso.ts",
  "better-sqlite3": "./src/better-sqlite3.ts",
  "bun-sqlite": "./src/bun-sqlite.ts",
  d1: "./src/d1.ts",
  "drizzle-factory": "./src/drizzle-factory.ts",
  ddl: "./src/ddl.ts",
  schema: "./src/schema/index.ts",
});
