/**
 * Statement turns for the single-connection SQLite adapters: every plain method, `setup`, `health`
 * and `teardown` of an adapter takes its place in the queue its transactions use, so none lands
 * inside a transaction it does not belong to (see `transaction-mutex.ts`). Internal to the package.
 */
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { TransactionMutex } from "./transaction-mutex.ts";

type PlainMethod = (...args: unknown[]) => Promise<unknown>;

/** The adapter methods that run one statement on the connection. */
const PLAIN_METHODS = ["insert", "update", "updateWhere", "get", "remove", "list", "count", "all"];

/**
 * Make every plain method of `adapter` take a one-statement turn on `mutex`: after every
 * transaction and statement that asked before it, so it never lands inside an open transaction
 * (and is never rolled back with one), and an error at once from inside a callback, where it
 * should have used `tx`. `health` takes a statement turn and `teardown` waits its turn, then closes.
 */
export function isolatePlainStatements(
  adapter: DatabaseAdapter,
  mutex: TransactionMutex,
): DatabaseAdapter {
  const wrapped: Record<string, unknown> = {};
  for (const method of PLAIN_METHODS) {
    // The one contained cast: the methods are generic, and this only forwards their arguments.
    const original = (adapter as unknown as Record<string, PlainMethod | undefined>)[method];
    if (original !== undefined) {
      wrapped[method] = async (...args: unknown[]): Promise<unknown> =>
        await mutex.runStatement(method, async () => await original.apply(adapter, args));
    }
  }
  return { ...adapter, ...wrapped, ...isolateLifecycle(adapter, mutex) };
}

function isolateLifecycle(
  adapter: DatabaseAdapter,
  mutex: TransactionMutex,
): Pick<DatabaseAdapter, "lifecycle"> {
  const { lifecycle } = adapter;
  if (lifecycle === undefined) {
    return {};
  }
  return {
    lifecycle: {
      ...lifecycle,
      // Migrations run on the shared connection: never inside another caller's transaction.
      setup: async (context) => {
        await mutex.runStatement("setup", async () => {
          await lifecycle.setup(context);
        });
      },
      health: async () => await mutex.runStatement("health", async () => await lifecycle.health()),
      teardown: async () => {
        await mutex.runStatement("teardown", async () => {
          await lifecycle.teardown();
        });
      },
    },
  };
}
