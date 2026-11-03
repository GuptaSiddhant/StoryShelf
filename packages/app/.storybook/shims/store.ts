/**
 * Story-only stand-in for `src/store.ts`. The production store is request-scoped
 * (`AsyncLocalStorage`) and wired to a database, storage and runner; a story has none of them.
 * This one holds a fixed, deterministic store that a page story can adjust with `setStoryStore`.
 * Pages call the same `getStore()` / `testingEnabled()` / `catalogOf()` they do in production.
 */
import type { Store } from "../../src/store.ts";

/** Projects the shell's project picker lists. */
export const STORY_PROJECTS = [
  { id: "01JD0000000000000000000001", slug: "design-system", name: "Design system" },
  { id: "01JD0000000000000000000002", slug: "web-app", name: "Web app" },
];

const database = {
  tables: { projects: { name: "projects" } },
  list: async (): Promise<unknown[]> => await Promise.resolve(STORY_PROJECTS),
};

const baseStore = {
  db: database,
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

/** Replace the story store for the next render (merged over the defaults, never persisted). */
export function setStoryStore(overrides: Partial<Store> = {}): void {
  current = { ...baseStore, ...overrides };
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

/** Pages that read the catalog get the one a story supplies (empty by default). */
export function catalogOf(): never {
  throw new Error("This story reads the catalog: pass the data through props instead.");
}
