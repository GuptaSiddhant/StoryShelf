/**
 * One transaction at a time per adapter. The built-in SQLite adapters run on a single connection,
 * and SQLite refuses a `BEGIN` inside an open transaction, so two overlapping `transact` calls
 * (the queue's acks, approvals under load) would fail the second one. The mutex makes the second
 * wait for the first to commit or roll back instead.
 *
 * A callback that calls `transact` on the same adapter again could never get the mutex it already
 * holds, which would hang; it fails at once with a clear error instead (use the `tx` it was given).
 */
import { AsyncLocalStorage } from "node:async_hooks";

/** Runs transaction bodies one at a time, in the order they asked. */
export interface TransactionMutex {
  run<R>(body: () => Promise<R>): Promise<R>;
}

/** A mutex for one adapter; each adapter instance owns its own. */
export function createTransactionMutex(): TransactionMutex {
  const inside = new AsyncLocalStorage<true>();
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run: async <R>(body: () => Promise<R>): Promise<R> => {
      if (inside.getStore() === true) {
        throw new Error("transact was called inside a transaction of the same database; use `tx`");
      }
      const turn = tail.then(async () => await inside.run(true, body));
      // The next transaction waits for this one to end either way, never for its error.
      tail = turn.catch(() => {});
      return await turn;
    },
  };
}
