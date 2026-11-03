/**
 * Story-only stand-in for `src/store.ts`. The production store is request-scoped
 * (`AsyncLocalStorage`) and wired to a database, storage and runner; a story has none of them.
 * This one holds a fixed, deterministic store that a page story can adjust with `setStoryStore`.
 * Pages call the same `getStore()` / `testingEnabled()` / `catalogOf()` they do in production.
 */
import type { CatalogLoader } from "@storyshelf/core/capture";
import type { Store } from "../../src/store.ts";
import type { StoryDataset } from "../../src/stories-fixtures/database.ts";
import { seedStoryDatabase } from "../../src/stories-fixtures/database.ts";

const baseStore = {
  db: {},
  storage: {},
  config: { secret: "storybook-secret", publishedBaseDomain: undefined },
  ui: {},
  logger: { info: () => null, warn: () => null, error: () => null },
  user: null,
  authEnabled: false,
  sessionId: "default",
  testing: true,
  design: [],
  notifiers: [],
} as unknown as Store;

let current: Store = baseStore;
let catalog: CatalogLoader | null = null;

/** Seed the in-memory database for a story and make it the store's database. */
export async function useStoryDataset(dataset: StoryDataset): Promise<void> {
  const seeded = await seedStoryDatabase(dataset);
  catalog = seeded.catalog;
  current = { ...current, db: seeded.db };
}

/** Replace the story store for the next render (merged over the defaults, never persisted). */
export function setStoryStore(overrides: Partial<Store> = {}): void {
  current = { ...baseStore, ...overrides };
  catalog = null;
}

export function runWithStore<T>(_store: Store, fn: () => T): T {
  return fn();
}

export function getStore(): Store {
  return current;
}

export function testingEnabled(store: Store = current): boolean {
  return store.testing;
}

/** The catalog of the story's dataset (null catalogs for builds with nothing published). */
export function catalogOf(): CatalogLoader {
  if (!catalog) throw new Error("This story reads the catalog: pick a dataset for the page story.");
  return catalog;
}
