import type { DatabaseChoice, StorageChoice } from "./answers.ts";

/** The import, constructor call and prelude each database and storage choice generates into `src/index.ts`. */

export const DB_IMPORT: Record<DatabaseChoice, string> = {
  sqlite: `import { createSqliteDatabase } from "@storyshelf/db-sqlite";`,
  turso: `import { createTursoDatabase } from "@storyshelf/db-sqlite/turso";`,
  "better-sqlite3": `import { createBetterSqlite3Database } from "@storyshelf/db-sqlite/better-sqlite3";`,
  "bun-sqlite": `import { createBunSqliteDatabase } from "@storyshelf/db-sqlite/bun-sqlite";`,
  d1: `import { createD1Database } from "@storyshelf/db-sqlite/d1";`,
  postgres: `import { createPostgresDatabase } from "@storyshelf/db-postgres";`,
  pg: `import { createPgDatabase } from "@storyshelf/db-postgres/pg";`,
  neon: `import { createNeonDatabase } from "@storyshelf/db-postgres/neon";`,
  "neon-http": `import { createNeonHttpDatabase } from "@storyshelf/db-postgres/neon-http";`,
  vercel: `import { createVercelDatabase } from "@storyshelf/db-postgres/vercel";`,
  pglite: `import { createPgliteDatabase } from "@storyshelf/db-postgres/pglite";`,
  mysql: `import { createMysqlDatabase } from "@storyshelf/db-mysql";`,
  planetscale: `import { createPlanetscaleDatabase } from "@storyshelf/db-mysql/planetscale";`,
  tidb: `import { createTidbDatabase } from "@storyshelf/db-mysql/tidb";`,
};

export const STORAGE_IMPORT: Record<StorageChoice, string> = {
  local: `import { createLocalStorage } from "@storyshelf/storage-local";`,
  s3: `import { createS3Storage } from "@storyshelf/storage-s3";`,
  azure: `import { createAzureStorage } from "@storyshelf/storage-azure";`,
  gcs: `import { createGcsStorage } from "@storyshelf/storage-gcs";`,
};

export const DB_INIT: Record<DatabaseChoice, string> = {
  sqlite: `createSqliteDatabase(\`\${dataDir}/shelf.db\`)`,
  turso: `createTursoDatabase({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN })`,
  "better-sqlite3": `createBetterSqlite3Database({ path: \`\${dataDir}/shelf.db\` })`,
  "bun-sqlite": `createBunSqliteDatabase({ path: \`\${dataDir}/shelf.db\` })`,
  d1: `createD1Database({ client: getD1Binding() })`,
  postgres: `createPostgresDatabase({ url: process.env.DATABASE_URL! })`,
  pg: `createPgDatabase({ url: process.env.DATABASE_URL! })`,
  neon: `createNeonDatabase({ url: process.env.DATABASE_URL! })`,
  "neon-http": `createNeonHttpDatabase({ url: process.env.DATABASE_URL! })`,
  vercel: `createVercelDatabase()`,
  pglite: `createPgliteDatabase()`,
  mysql: `createMysqlDatabase({ url: process.env.DATABASE_URL! })`,
  planetscale: `createPlanetscaleDatabase({ url: process.env.DATABASE_URL! })`,
  tidb: `createTidbDatabase({ url: process.env.DATABASE_URL! })`,
};

/** Extra scaffolding before `const database = ...` (D1 binding stub). */
export function dbPrelude(database: DatabaseChoice): string[] {
  if (database !== "d1") {
    return [];
  }
  return [
    `// TODO: provide your D1 binding (Cloudflare Workers: env.DB).`,
    `function getD1Binding(): never {`,
    `  throw new Error("Provide your D1 database binding (env.DB).");`,
    `}`,
  ];
}

export const STORAGE_INIT: Record<StorageChoice, string> = {
  local: `createLocalStorage(dataDir)`,
  s3: `createS3Storage({ bucket: process.env.S3_BUCKET!, region: process.env.AWS_REGION })`,
  azure: `createAzureStorage({ container: "storybook", connectionString: process.env.AZURE_STORAGE_CONNECTION! })`,
  gcs: `createGcsStorage({ bucket: process.env.GCS_BUCKET! })`,
};
