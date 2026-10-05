/**
 * In-memory test doubles for adapter-contract tests.
 *
 * Re-exports the focused fakes so existing imports keep working; new code
 * should import `fake-storage.ts`, `fake-database.ts`, or `sql-chunks.ts`
 * directly.
 */
import type { DatabaseAdapter } from "../adapters/database.ts";
import { REQUIRED_TABLE_KEYS } from "../adapters/database.ts";
export { makeDatabase } from "./fake-database.ts";
export { makeStorage, type FakeStorage } from "./fake-storage.ts";

/**
 * Empty table map for spec/test doubles whose methods never run (OpenAPI
 * generation, asset serving). Satisfies boot validation without a driver.
 */
export function stubTables(): DatabaseAdapter["tables"] {
  const tables: Record<string, unknown> = {};
  for (const key of REQUIRED_TABLE_KEYS) {
    tables[key] = {};
  }
  return tables as unknown as DatabaseAdapter["tables"];
}
