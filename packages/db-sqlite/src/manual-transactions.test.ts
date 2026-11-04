import type { DatabaseAdapter, TxStore } from "@storyshelf/core/adapter/database";
import { describe, expect, it, vi } from "vitest";
import { withManualTransactions } from "./manual-transactions.ts";

/** An adapter that only records the plain calls the transaction store forwards to it. */
function stubAdapter(calls: string[]): DatabaseAdapter {
  const record = (name: string) => async () => {
    calls.push(name);
    return await Promise.resolve({ id: name });
  };
  return {
    insert: record("insert"),
    update: record("update"),
    get: record("get"),
    remove: async () => {
      calls.push("remove");
    },
    list: async () => {
      calls.push("list");
      return await Promise.resolve([]);
    },
    count: async () => {
      calls.push("count");
      return await Promise.resolve(0);
    },
  } as unknown as DatabaseAdapter;
}

function transactOf(db: DatabaseAdapter) {
  const { transact } = db;
  if (transact === undefined) throw new Error("no transact");
  return async <R>(fn: (tx: TxStore) => Promise<R>): Promise<R> =>
    (await transact.call(db, fn)) as R;
}

describe("withManualTransactions", () => {
  it("brackets the body in BEGIN and COMMIT and returns its result", async () => {
    const statements: string[] = [];
    const db = withManualTransactions(stubAdapter(statements), (sql) => {
      statements.push(sql);
    });

    const result = await transactOf(db)(async () => {
      statements.push("body");
      return await Promise.resolve("done");
    });

    expect(result).toBe("done");
    expect(statements).toEqual(["BEGIN", "body", "COMMIT"]);
  });

  it("gives the body a store that runs on the adapter's own connection", async () => {
    const calls: string[] = [];
    const db = withManualTransactions(stubAdapter(calls), () => {});

    await transactOf(db)(async (tx) => {
      await tx.insert({} as never, {} as never);
      await tx.update({} as never, "id", {} as never);
      await tx.get({} as never, "id");
      await tx.remove({} as never, "id");
      await tx.list({} as never);
      await tx.count({} as never);
    });

    expect(calls).toEqual(["insert", "update", "get", "remove", "list", "count"]);
  });

  it("rolls back and rethrows the body's error", async () => {
    const statements: string[] = [];
    const db = withManualTransactions(stubAdapter([]), (sql) => {
      statements.push(sql);
    });

    await expect(
      transactOf(db)(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(statements).toEqual(["BEGIN", "ROLLBACK"]);
  });

  it("reports the cause when the rollback itself fails", async () => {
    const exec = vi.fn((sql: string) => {
      if (sql === "ROLLBACK") throw new Error("no transaction is active");
    });
    const db = withManualTransactions(stubAdapter([]), exec);

    await expect(
      transactOf(db)(async () => {
        throw new Error("constraint failed");
      }),
    ).rejects.toThrow("constraint failed");
  });

  it("runs overlapping transactions one at a time", async () => {
    const statements: string[] = [];
    const db = withManualTransactions(stubAdapter([]), (sql) => {
      statements.push(sql);
    });
    const transact = transactOf(db);
    const release = Promise.withResolvers<null>();

    const first = transact(async () => {
      statements.push("first");
      await release.promise;
    });
    const second = transact(async () => {
      statements.push("second");
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(statements).toEqual(["BEGIN", "first"]);

    release.resolve(null);
    await Promise.all([first, second]);
    expect(statements).toEqual(["BEGIN", "first", "COMMIT", "BEGIN", "second", "COMMIT"]);
  });
});
