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
 *
 * A plain statement (an `insert`, a page's `get`) needs the same care: on the one connection it
 * would run inside whatever transaction is open and be committed or rolled back with it. It takes
 * a one-statement turn on the same queue, so it can never land inside a transaction, and one
 * issued on the outer adapter from inside a callback is the same misuse as a nested `transact`.
 * Only the built-in adapters on a single connection (`node:sqlite`, better-sqlite3, `bun:sqlite`)
 * use this; Turso, D1, Postgres and MySQL have real transaction handles or pooled connections.
 */

/** Marks the code running inside a transaction, so a nested `transact` can be told apart. */
export interface NestingGuard {
  /** Whether the runtime can tell a nested call from an independent one at all. */
  detects: boolean;
  /** Run `body` as a transaction; `inside()` is true within it and anything it starts, until it ends. */
  enter<R>(body: () => Promise<R>): Promise<R>;
  /** Whether the caller runs inside a transaction that has not ended. */
  inside(): boolean;
}

/** Runs transaction bodies one at a time, in the order they asked. */
export interface TransactionMutex {
  run<R>(body: () => Promise<R>): Promise<R>;
  /**
   * Run one plain statement (`method` names it in errors) as a turn of its own: after every
   * transaction and statement that asked before it, never inside one. Throws at once from inside a
   * transaction's own async context, where waiting would never end.
   */
  runStatement<R>(method: string, body: () => Promise<R>): Promise<R>;
}

/**
 * How long a transaction waits for its turn where nesting cannot be detected. A nested call there
 * waits for the transaction it sits in, which waits for it; the limit turns that into an error for
 * the nested call, which ends the outer transaction and frees the queue. It only counts the wait
 * for the turn, never a transaction's own run time.
 */
export const UNGUARDED_WAIT_LIMIT_MS = 30_000;

/** Options of {@link createTransactionMutex}. */
export interface TransactionMutexOptions {
  /** Wait limit in ms; defaults to {@link UNGUARDED_WAIT_LIMIT_MS} when the guard cannot detect, else none. */
  waitLimitMs?: number;
  /** Runs `fire` after `ms` and returns what cancels it (default the global timers); tests inject a manual one. */
  schedule?: (fire: () => void, ms: number) => () => void;
}

const globalSchedule = (fire: () => void, ms: number): (() => void) => {
  const timer = setTimeout(fire, ms);
  return () => {
    clearTimeout(timer);
  };
};

/** A mutex for one adapter; each adapter instance owns its own. */
export function createTransactionMutex(
  guard: NestingGuard,
  options: TransactionMutexOptions = {},
): TransactionMutex {
  const limit = options.waitLimitMs ?? (guard.detects ? undefined : UNGUARDED_WAIT_LIMIT_MS);
  let tail: Promise<unknown> = Promise.resolve();
  /** Take the next place in the queue for `work`; `what` names the caller if its wait runs out. */
  const queued = async <R>(what: string, work: () => Promise<R>): Promise<R> => {
    const turn = new Turn(what);
    const done = tail.then(async () => {
      turn.begin();
      return await work();
    });
    // The next turn waits for this one to end either way, never for its error.
    tail = done.catch(() => {});
    return await (limit === undefined
      ? done
      : turn.within(done, limit, options.schedule ?? globalSchedule));
  };
  return {
    run: async <R>(body: () => Promise<R>): Promise<R> => {
      if (guard.inside()) {
        throw new Error("transact was called inside a transaction of the same database; use `tx`");
      }
      return await queued("transaction", async () => await guard.enter(body));
    },
    runStatement: async <R>(method: string, body: () => Promise<R>): Promise<R> => {
      if (guard.inside()) {
        throw new Error(
          `a plain ${method} was called on the database inside its own transaction; use \`tx\``,
        );
      }
      return await queued(`plain ${method}`, body);
    },
  };
}

/** One caller's place in the queue: whether its turn has come, and a limit on how long to wait for it. */
class Turn {
  #started = false;
  #abandoned = false;
  readonly #what: string;

  constructor(what: string) {
    this.#what = what;
  }

  /** The turn came: stop if the caller already gave up (the wait limit passed), else go on. */
  begin(): void {
    if (this.#abandoned) {
      throw new Error(`${this.#what} gave up waiting for its turn`);
    }
    this.#started = true;
  }

  /** `done`, or an error if the turn has not come within `limitMs`. */
  async within<R>(
    done: Promise<R>,
    limitMs: number,
    schedule: (fire: () => void, ms: number) => () => void,
  ): Promise<R> {
    let cancel: (() => void) | undefined;
    const expired = new Promise<never>((_resolve, reject) => {
      cancel = schedule(() => {
        if (this.#started) return;
        this.#abandoned = true;
        reject(
          new Error(
            `${this.#what} waited ${String(limitMs)} ms for the previous one to end; a transaction may have opened another on the same database, use \`tx\` instead`,
          ),
        );
      }, limitMs);
    });
    try {
      return await Promise.race([done, expired]);
    } finally {
      cancel?.();
    }
  }
}
