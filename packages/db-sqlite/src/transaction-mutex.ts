/**
 * One transaction at a time per adapter. The built-in SQLite adapters run on a single connection,
 * and SQLite refuses a `BEGIN` inside an open transaction, so two overlapping `transact` calls
 * (the queue's acks, approvals under load) would fail the second one. The mutex makes the second
 * wait for the first to commit or roll back instead.
 *
 * A callback that calls `transact` on the same adapter again could never get the mutex it already
 * holds, which would hang, so every mutex takes a {@link NestingGuard} (`nesting-guard.ts`) that
 * turns that into an immediate error saying to use the `tx` the callback was given, where the
 * runtime can track async context.
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
export function createTransactionMutex(guard: NestingGuard): TransactionMutex {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run: async <R>(body: () => Promise<R>): Promise<R> => {
      if (guard.inside()) {
        throw new Error("transact was called inside a transaction of the same database; use `tx`");
      }
      const turn = tail.then(async () => await guard.enter(body));
      // The next transaction waits for this one to end either way, never for its error.
      tail = turn.catch(() => {});
      return await turn;
    },
  };
}
