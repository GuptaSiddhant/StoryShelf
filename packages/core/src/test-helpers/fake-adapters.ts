/**
 * In-memory test doubles for adapter-contract tests.
 *
 * Re-exports the focused fakes so existing imports keep working; new code
 * should import `fake-storage.ts`, `fake-database.ts`, or `sql-chunks.ts`
 * directly.
 */
export { makeDatabase } from "./fake-database.ts";
export { makeStorage, type FakeStorage } from "./fake-storage.ts";
