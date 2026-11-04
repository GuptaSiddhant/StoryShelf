/**
 * Nested-transaction detection (see `transaction-mutex.ts`). It needs async context tracking,
 * which Node and Bun have as `node:async_hooks` and a Cloudflare Worker may not, so the module is
 * looked up at run time with `process.getBuiltinModule` and never imported: where it is missing
 * the guard detects nothing and a nested `transact` waits for the mutex's wait limit instead of failing at once. Importing it
 * statically would stop the D1 entry point from loading in a Worker without Node compatibility.
 */
import type { NestingGuard } from "./transaction-mutex.ts";

/** The part of `AsyncLocalStorage` the guard uses. */
interface ScopeStorage {
  getStore(): { open: boolean } | undefined;
  run<R>(store: { open: boolean }, body: () => R): R;
}

type ScopeStorageConstructor = new () => ScopeStorage;

/** `AsyncLocalStorage` where the runtime has it, else undefined. */
function findScopeStorage(): ScopeStorageConstructor | undefined {
  const runtime = (
    globalThis as {
      process?: { getBuiltinModule?: (id: string) => unknown };
    }
  ).process;
  const loaded = runtime?.getBuiltinModule?.("node:async_hooks") as
    | { AsyncLocalStorage?: ScopeStorageConstructor }
    | undefined;
  return loaded?.AsyncLocalStorage;
}

/** A guard for one adapter; it detects nothing where the runtime has no async context tracking. */
export function createNestingGuard(): NestingGuard {
  const Storage = findScopeStorage();
  if (Storage === undefined) {
    return { detects: false, inside: () => false, enter: async (body) => await body() };
  }
  // Work started inside a body keeps this store after the body ends, so what marks a nested call
  // is the transaction still being open, not the store being present.
  const scopes = new Storage();
  return {
    detects: true,
    inside: () => scopes.getStore()?.open === true,
    enter: async <R>(body: () => Promise<R>): Promise<R> => {
      const scope = { open: true };
      try {
        return await scopes.run(scope, body);
      } finally {
        scope.open = false;
      }
    },
  };
}
