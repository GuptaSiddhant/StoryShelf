/**
 * One transaction at a time per adapter. The built-in SQLite adapters run on a single connection,
 * and SQLite refuses a `BEGIN` inside an open transaction, so two overlapping `transact` calls
 * (the queue's acks, approvals under load) would fail the second one. The mutex makes the second
 * wait for the first to commit or roll back instead.
 *
 * A callback that calls `transact` on the same adapter again could never get the mutex it already
 * holds, which would hang. Where the runtime has async context tracking, a {@link NestingGuard}
 * (`nesting-guard.ts`) turns that into an immediate error that says to use the `tx` the callback
 * was given. This module must not import it: the D1 and Turso entry points load this file, and
 * they also run where `node:async_hooks` does not exist. Without a guard a nested call waits.
 */

/** Marks the code running inside a transaction, so a nested `transact` can be told apart. */
export interface NestingGuard {
  /** Run `body` as a transaction; `inside()` is true within it and anything it starts, until it ends. */
  enter<R>(body: () => Promise<R>): Promise<R>;
  /** Whether the caller runs inside a transaction that has not ended. */
  inside(): boolean;
}

/** Runs transaction bodies one at a time, in the order they asked. */
export interface TransactionMutex {
  run<R>(body: () => Promise<R>): Promise<R>;
}

/** A mutex for one adapter; each adapter instance owns its own. */
export function createTransactionMutex(guard?: NestingGuard): TransactionMutex {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run: async <R>(body: () => Promise<R>): Promise<R> => {
      if (guard?.inside() === true) {
        throw new Error("transact was called inside a transaction of the same database; use `tx`");
      }
      const turn = tail.then(async () => (guard ? await guard.enter(body) : await body()));
      // The next transaction waits for this one to end either way, never for its error.
      tail = turn.catch(() => {});
      return await turn;
    },
  };
}
