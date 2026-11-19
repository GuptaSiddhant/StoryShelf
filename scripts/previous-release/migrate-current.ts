import { mkdirSync } from "node:fs";
import type { DatabaseAdapter } from "../../packages/core/src/adapters/database.ts";
// oxlint-disable max-statements curly no-console
// Runs THIS checkout's migrations on a database as release RELEASE and exits (ADR 0053 decision 8,
// step 2). Run from the repo root with `nub scripts/previous-release/migrate-current.ts`: nub runs
// the TypeScript source, and the imports are relative because scripts/ has no workspace links.
// RELEASE is the release this code will ship as; it must be one minor ahead of the previous
// release for step 3 to skip that release's migrations.
// Env: DIALECT (sqlite|postgres), RELEASE, DATABASE_URL (postgres) or DATA_DIR (sqlite).
import { createShelfLogger } from "../../packages/core/src/logger.ts";

const dialect = process.env["DIALECT"];
const release = process.env["RELEASE"];
if (release === undefined) throw new Error("RELEASE is required");
const dataDir = process.env["DATA_DIR"] ?? ".data";
mkdirSync(dataDir, { recursive: true });

async function open(): Promise<DatabaseAdapter> {
  if (dialect === "sqlite") {
    const { createSqliteDatabase } = await import("../../packages/db-sqlite/src/index.ts");
    return createSqliteDatabase(`${dataDir}/shelf.db`);
  }
  if (dialect === "postgres") {
    const { createPostgresDatabase } = await import("../../packages/db-postgres/src/index.ts");
    return createPostgresDatabase({ url: process.env["DATABASE_URL"] });
  }
  throw new Error(`unknown DIALECT: ${dialect}`);
}

const database = await open();
const logger = createShelfLogger({ level: "warn" });
await database.lifecycle?.setup({ config: {}, logger, release });
await database.lifecycle?.teardown?.();
console.log(`migrated with this checkout as release ${release} (${dialect})`);
