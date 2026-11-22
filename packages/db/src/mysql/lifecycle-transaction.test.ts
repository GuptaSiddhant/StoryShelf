/**
 * The lifecycle's transaction plumbing, against a recording connection. What the transactions
 * guarantee across sessions is proven only on a real server (`build-reference-lifecycle.live.test.ts`).
 */
import { describe, expect, it, vi } from "vitest";
import { stripeOf } from "./content-uses.ts";
import {
  chunks,
  inTransaction,
  instant,
  isDeadlock,
  retryingDeadlocks,
  rowsOf,
  type LifecycleConnection,
} from "./lifecycle-transaction.ts";

function recording(fail?: (statement: string) => unknown) {
  const statements: string[] = [];
  const connection: LifecycleConnection = {
    query: vi.fn(async (statement: string) => {
      statements.push(statement);
      const error = fail?.(statement);
      if (error) throw error;
      return [[{ n: 1 }], []];
    }),
    release: vi.fn(),
    destroy: vi.fn(),
  };
  return { statements, connection, pool: { getConnection: async () => connection } };
}

describe("inTransaction", () => {
  it("runs at READ COMMITTED on one borrowed connection and commits", async () => {
    const { statements, connection, pool } = recording();
    const rows = await inTransaction(pool, async ({ query }) => await query("SELECT 1"));
    expect(rows).toEqual([{ n: 1 }]);
    expect(statements).toEqual([
      "SET TRANSACTION ISOLATION LEVEL READ COMMITTED",
      "START TRANSACTION",
      "SELECT 1",
      "COMMIT",
    ]);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("rolls back and rethrows, and destroys a connection that cannot roll back", async () => {
    const { statements, connection, pool } = recording((statement) =>
      statement === "ROLLBACK" ? new Error("gone") : undefined,
    );
    await expect(
      inTransaction(pool, async () => {
        throw new Error("domain");
      }),
    ).rejects.toThrow("domain");
    expect(statements.at(-1)).toBe("ROLLBACK");
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.release).not.toHaveBeenCalled();
  });

  it("repeats a deadlock victim, but never a caller's callback", async () => {
    const deadlock = Object.assign(new Error("deadlock"), { errno: 1213 });
    let calls = 0;
    const { pool } = recording();
    const flaky = async (): Promise<string> => {
      calls += 1;
      if (calls < 3) throw deadlock;
      return await Promise.resolve("ok");
    };
    expect(await inTransaction(pool, flaky)).toBe("ok");
    expect(calls).toBe(3);

    calls = 0;
    await expect(inTransaction(pool, flaky, false)).rejects.toBe(deadlock);
    expect(calls).toBe(1);
  });
});

describe("helpers", () => {
  it("recognizes only InnoDB's deadlock", () => {
    expect(isDeadlock({ errno: 1213 })).toBe(true);
    expect(isDeadlock({ code: "ER_LOCK_DEADLOCK" })).toBe(true);
    expect(isDeadlock({ errno: 1205 })).toBe(false);
    expect(isDeadlock(null)).toBe(false);
  });

  it("gives up on a deadlock after a bounded number of attempts", async () => {
    const fn = vi.fn(async () => {
      throw Object.assign(new Error("deadlock"), { errno: 1213 });
    });
    await expect(retryingDeadlocks(fn)).rejects.toThrow("deadlock");
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it("reads rows from a mysql2 answer and nothing from a write", () => {
    expect(rowsOf([[{ id: "a" }], []])).toEqual([{ id: "a" }]);
    expect(rowsOf([{ affectedRows: 1 }, undefined])).toEqual([]);
    expect(rowsOf(null)).toEqual([]);
  });

  it("slices long lists and writes UTC DATETIME text", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunks([])).toEqual([]);
    expect(instant("2026-11-20T10:00:00.123Z")).toBe("2026-11-20 10:00:00.123");
  });

  it("puts a hash in the same stripe in every process, within the stripe count", () => {
    expect(stripeOf("abc")).toBe(stripeOf("abc"));
    const stripes = new Set(Array.from({ length: 2000 }, (_, index) => stripeOf(`hash-${index}`)));
    expect(Math.max(...stripes)).toBeLessThan(64);
    expect(stripes.size).toBe(64);
  });
});
