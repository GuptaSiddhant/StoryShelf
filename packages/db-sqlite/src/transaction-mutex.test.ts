import type { DatabaseAdapter, TxStore } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import { describe, expect, it } from "vitest";
import { createBetterSqlite3Database } from "./better-sqlite3.ts";
import { createSqliteDatabase } from "./index.ts";
import { schema } from "./schema/index.ts";
import { createTransactionMutex } from "./transaction-mutex.ts";

const now = "2026-01-01T00:00:00.000Z";
const silentLogger = createShelfLogger({ level: "silent" });

async function open(db: DatabaseAdapter): Promise<DatabaseAdapter> {
  await db.lifecycle?.setup({ config: {}, logger: silentLogger });
  return db;
}

const setting = (id: string) => ({ id, value: id, createdAt: now, updatedAt: now });

async function transactOf(db: DatabaseAdapter) {
  const { transact } = db;
  if (transact === undefined) throw new Error("no transact");
  return async <R>(fn: (tx: TxStore) => Promise<R>): Promise<R> =>
    (await transact.call(db, fn)) as R;
}

describe("createTransactionMutex", () => {
  it("runs bodies one at a time, in the order they asked", async () => {
    const mutex = createTransactionMutex();
    const log: string[] = [];
    const body = (name: string, ms: number) => async () => {
      log.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      log.push(`${name}:end`);
      return name;
    };

    const results = await Promise.all([
      mutex.run(body("a", 20)),
      mutex.run(body("b", 1)),
      mutex.run(body("c", 1)),
    ]);

    expect(results).toEqual(["a", "b", "c"]);
    expect(log).toEqual(["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
  });

  it("releases after a body throws, and reports the error to its own caller only", async () => {
    const mutex = createTransactionMutex();
    const failing = mutex.run(async () => await Promise.reject(new Error("boom")));
    const next = mutex.run(async () => await Promise.resolve("ran"));

    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ran");
  });

  it("refuses a nested run from inside a body instead of hanging", async () => {
    const mutex = createTransactionMutex();

    await expect(
      mutex.run(async () => await mutex.run(async () => await Promise.resolve(1))),
    ).rejects.toThrow("inside a transaction");
    await expect(mutex.run(async () => await Promise.resolve(2))).resolves.toBe(2);
  });

  it("gives each mutex its own queue", async () => {
    const first = createTransactionMutex();
    const second = createTransactionMutex();
    const gate = Promise.withResolvers<null>();
    const held = first.run(async () => await gate.promise);

    await expect(second.run(async () => await Promise.resolve("free"))).resolves.toBe("free");
    gate.resolve(null);
    await held;
  });
});

const drivers: [string, () => DatabaseAdapter][] = [
  ["node:sqlite", () => createSqliteDatabase(":memory:")],
  ["better-sqlite3", () => createBetterSqlite3Database({ path: ":memory:" })],
];

describe.each(drivers)("transact on %s", (_name, make) => {
  it("commits every one of many overlapping transactions, none failing", async () => {
    const db = await open(make());
    const transact = await transactOf(db);

    const results = await Promise.allSettled(
      Array.from({ length: 25 }, async (_unused, index) =>
        transact(async (tx) => {
          await tx.insert(schema.siteSettings, setting(`s${String(index)}`));
          await Promise.resolve();
          return index;
        }),
      ),
    );

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(await db.count(schema.siteSettings)).toBe(25);
  });

  it("rolls a throwing transaction back, releases the mutex, and lets the next one commit", async () => {
    const db = await open(make());
    const transact = await transactOf(db);

    const failing = transact(async (tx) => {
      await tx.insert(schema.siteSettings, setting("doomed"));
      throw new Error("abort");
    });
    const next = transact(async (tx) => await tx.insert(schema.siteSettings, setting("kept")));

    await expect(failing).rejects.toThrow("abort");
    await next;
    expect(await db.get(schema.siteSettings, "doomed")).toBeNull();
    expect(await db.get(schema.siteSettings, "kept")).not.toBeNull();
  });

  it("fails a transaction that opens another on the same database, instead of hanging", async () => {
    const db = await open(make());
    const transact = await transactOf(db);

    await expect(
      transact(async () => await transact(async () => await Promise.resolve())),
    ).rejects.toThrow("inside a transaction");
    await transact(async (tx) => await tx.insert(schema.siteSettings, setting("after")));
    expect(await db.get(schema.siteSettings, "after")).not.toBeNull();
  });
});
