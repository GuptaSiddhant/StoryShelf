/**
 * Nested-transaction detection for runtimes with `node:async_hooks` (Node, Bun). Kept apart from
 * `transaction-mutex.ts` so the D1 and Turso entry points never load it; see that file.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { NestingGuard } from "./transaction-mutex.ts";

/** A guard for one adapter. */
export function createNestingGuard(): NestingGuard {
  // Work started inside a body keeps this store after the body ends, so what marks a nested call
  // is the transaction still being open, not the store being present.
  const scopes = new AsyncLocalStorage<{ open: boolean }>();
  return {
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
