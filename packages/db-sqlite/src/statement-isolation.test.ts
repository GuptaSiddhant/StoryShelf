import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { describe, expect, it } from "vite-plus/test";
import { createNestingGuard } from "./nesting-guard.ts";
import { isolatePlainStatements } from "./statement-isolation.ts";
import { createTransactionMutex } from "./transaction-mutex.ts";

const PLAIN = ["insert", "update", "updateWhere", "get", "remove", "list", "count", "all"] as const;

const settleTicks = async (): Promise<void> => {
  for (let tick = 0; tick < 10; tick += 1) {
    // oxlint-disable-next-line no-await-in-loop -- let queued promise callbacks run
    await Promise.resolve();
  }
};

/** An adapter whose methods only record that the connection was touched. */
function fakeAdapter(touched: string[]): DatabaseAdapter {
  const adapter: Record<string, unknown> = {
    lifecycle: {
      setup: async () => {
        touched.push("setup");
        await Promise.resolve();
      },
      health: async () => {
        touched.push("health");
        return await Promise.resolve({ ok: true });
      },
      teardown: async () => {
        touched.push("teardown");
        await Promise.resolve();
      },
    },
  };
  for (const method of PLAIN) {
    adapter[method] = async () => {
      touched.push(method);
      return await Promise.resolve(method);
    };
  }
  return adapter as unknown as DatabaseAdapter;
}

type Call = (db: DatabaseAdapter) => Promise<unknown>;

const calls: [string, Call][] = [
  ...PLAIN.map((method): [string, Call] => [
    method,
    async (db) => await (db as unknown as Record<string, () => Promise<unknown>>)[method]?.(),
  ]),
  ["setup", async (db) => await db.lifecycle?.setup({ config: {}, logger: {} as never })],
  ["health", async (db) => await db.lifecycle?.health()],
  ["teardown", async (db) => await db.lifecycle?.teardown()],
];

describe("isolatePlainStatements", () => {
  it.each(calls)("%s waits for an open transaction and runs after it ends", async (name, call) => {
    const touched: string[] = [];
    const mutex = createTransactionMutex(createNestingGuard());
    const db = isolatePlainStatements(fakeAdapter(touched), mutex);
    const release = Promise.withResolvers<null>();
    const holder = mutex.run(async () => await release.promise);

    const pending = call(db);
    await settleTicks();
    expect(touched).toEqual([]);

    release.resolve(null);
    await holder;
    await pending;
    expect(touched).toEqual([name]);
  });

  it.each(calls)("%s refuses to run inside a transaction's own callback", async (name, call) => {
    const touched: string[] = [];
    const mutex = createTransactionMutex(createNestingGuard());
    const db = isolatePlainStatements(fakeAdapter(touched), mutex);

    await expect(mutex.run(async () => await call(db))).rejects.toThrow(
      `a plain ${name} was called on the database inside its own transaction; use \`tx\``,
    );
    expect(touched).toEqual([]);
  });

  it("leaves an adapter without a lifecycle as it is", () => {
    const mutex = createTransactionMutex(createNestingGuard());
    const db = isolatePlainStatements({} as DatabaseAdapter, mutex);
    expect(db.lifecycle).toBeUndefined();
  });
});
