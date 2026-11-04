import type { DatabaseAdapter, TxStore } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBetterSqlite3Database } from "./better-sqlite3.ts";
import { createSqliteDatabase } from "./index.ts";
import { createNestingGuard } from "./nesting-guard.ts";
import { schema } from "./schema/index.ts";
import { createTransactionMutex, type NestingGuard } from "./transaction-mutex.ts";

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
    const mutex = createTransactionMutex(createNestingGuard());
    const log: string[] = [];
    const gate = Promise.withResolvers<null>();
    const body = (name: string, hold?: Promise<null>) => async () => {
      log.push(`${name}:start`);
      await hold;
      log.push(`${name}:end`);
      return name;
    };

    const all = Promise.all([
      mutex.run(body("a", gate.promise)),
      mutex.run(body("b")),
      mutex.run(body("c")),
    ]);
    // `a` holds the mutex at the gate: `b` and `c` have not started.
    await Promise.resolve();
    await Promise.resolve();
    expect(log).toEqual(["a:start"]);
    gate.resolve(null);

    expect(await all).toEqual(["a", "b", "c"]);
    expect(log).toEqual(["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
  });

  it("releases after a body throws, and reports the error to its own caller only", async () => {
    const mutex = createTransactionMutex(createNestingGuard());
    const failing = mutex.run(async () => await Promise.reject(new Error("boom")));
    const next = mutex.run(async () => await Promise.resolve("ran"));

    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ran");
  });

  it("refuses a nested run from inside a body instead of hanging", async () => {
    const mutex = createTransactionMutex(createNestingGuard());

    await expect(
      mutex.run(async () => await mutex.run(async () => await Promise.resolve(1))),
    ).rejects.toThrow("inside a transaction");
    await expect(mutex.run(async () => await Promise.resolve(2))).resolves.toBe(2);
  });

  it("lets work started inside a body run later, once the body has ended", async () => {
    const mutex = createTransactionMutex(createNestingGuard());
    const gate = Promise.withResolvers<null>();
    let later: Promise<string> = Promise.resolve("never started");
    await mutex.run(async () => {
      // Started inside the body, so it inherits the body's async context.
      later = (async () => {
        await gate.promise;
        return await mutex.run(async () => await Promise.resolve("queued"));
      })();
      return await Promise.resolve();
    });

    gate.resolve(null);

    await expect(later).resolves.toBe("queued");
  });

  it("gives each mutex its own queue", async () => {
    const first = createTransactionMutex(createNestingGuard());
    const second = createTransactionMutex(createNestingGuard());
    const gate = Promise.withResolvers<null>();
    const held = first.run(async () => await gate.promise);

    await expect(second.run(async () => await Promise.resolve("free"))).resolves.toBe("free");
    gate.resolve(null);
    await held;
  });
});

/** A runtime with no async context tracking: nothing tells a nested call from an independent one. */
const blindGuard: NestingGuard = {
  detects: false,
  inside: () => false,
  enter: async (body) => await body(),
};

/** A scheduler the test fires by hand, so no real time passes. */
function manualScheduler() {
  const pending = new Set<() => void>();
  return {
    schedule: (fire: () => void): (() => void) => {
      pending.add(fire);
      return () => {
        pending.delete(fire);
      };
    },
    /** Fire every timer that is still waiting, oldest first. */
    fireAll: () => {
      for (const fire of pending) {
        pending.delete(fire);
        fire();
      }
    },
  };
}

const settle = async (): Promise<void> => {
  for (let tick = 0; tick < 10; tick += 1) {
    // oxlint-disable-next-line no-await-in-loop -- let queued promise callbacks run
    await Promise.resolve();
  }
};

describe("createTransactionMutex where nesting cannot be detected", () => {
  it("fails a nested run once the wait limit passes, which ends the outer transaction and frees the queue", async () => {
    const clock = manualScheduler();
    const mutex = createTransactionMutex(blindGuard, {
      waitLimitMs: 1000,
      schedule: clock.schedule,
    });
    const outer = mutex.run(async () => await mutex.run(async () => await Promise.resolve(1)));
    outer.catch(() => {});
    await settle();

    clock.fireAll();

    await expect(outer).rejects.toThrow("waited 1000 ms");
    await expect(mutex.run(async () => await Promise.resolve("after"))).resolves.toBe("after");
  });

  it("never counts a transaction's own run time against it", async () => {
    const clock = manualScheduler();
    const mutex = createTransactionMutex(blindGuard, {
      waitLimitMs: 1000,
      schedule: clock.schedule,
    });
    const gate = Promise.withResolvers<string>();
    const long = mutex.run(async () => await gate.promise);
    await settle();

    clock.fireAll();
    gate.resolve("finished");

    await expect(long).resolves.toBe("finished");
  });

  it("does not run a transaction that gave up waiting once its turn comes", async () => {
    const clock = manualScheduler();
    const mutex = createTransactionMutex(blindGuard, {
      waitLimitMs: 1000,
      schedule: clock.schedule,
    });
    const gate = Promise.withResolvers<null>();
    let ran = false;
    const first = mutex.run(async () => await gate.promise);
    await settle();
    const second = mutex.run(async () => {
      ran = true;
      return await Promise.resolve(2);
    });
    second.catch(() => {});
    await settle();

    clock.fireAll();
    await expect(second).rejects.toThrow("waited 1000 ms");
    gate.resolve(null);
    await first;
    await mutex.run(async () => await Promise.resolve(3));

    expect(ran).toBe(false);
  });
});

describe("plain statements on the mutex", () => {
  it("waits for an open transaction, and runs when none is open", async () => {
    const mutex = createTransactionMutex(createNestingGuard());
    const gate = Promise.withResolvers<null>();
    const log: string[] = [];
    const opened = mutex.run(async () => {
      log.push("tx:start");
      await gate.promise;
      log.push("tx:end");
    });
    await settle();

    const statement = mutex.runStatement("get", async () => {
      log.push("statement");
      return await Promise.resolve("row");
    });
    await settle();
    expect(log).toEqual(["tx:start"]);
    gate.resolve(null);

    await opened;
    await expect(statement).resolves.toBe("row");
    expect(log).toEqual(["tx:start", "tx:end", "statement"]);
    await expect(mutex.runStatement("get", async () => await Promise.resolve(1))).resolves.toBe(1);
  });

  it("queues statements and transactions in the order they asked, so a statement never waits for a later transaction", async () => {
    const mutex = createTransactionMutex(createNestingGuard());
    const gate = Promise.withResolvers<null>();
    const log: string[] = [];
    const first = mutex.run(async () => {
      await gate.promise;
      log.push("tx1");
    });
    const statement = mutex.runStatement("insert", async () => {
      log.push("statement");
      return await Promise.resolve();
    });
    const later = mutex.run(async () => {
      log.push("tx2");
      return await Promise.resolve();
    });
    await settle();
    gate.resolve(null);

    await Promise.all([first, statement, later]);

    expect(log).toEqual(["tx1", "statement", "tx2"]);
  });

  it("refuses a plain statement from inside a transaction at once, naming the method", async () => {
    const mutex = createTransactionMutex(createNestingGuard());

    await expect(
      mutex.run(
        async () => await mutex.runStatement("insert", async () => await Promise.resolve()),
      ),
    ).rejects.toThrow(
      "a plain insert was called on the database inside its own transaction; use `tx`",
    );
    await expect(
      mutex.runStatement("get", async () => await Promise.resolve("after")),
    ).resolves.toBe("after");
  });

  it("releases after a statement throws, reporting the error to its own caller only", async () => {
    const mutex = createTransactionMutex(createNestingGuard());
    const failing = mutex.runStatement("get", async () => await Promise.reject(new Error("boom")));
    const next = mutex.run(async () => await Promise.resolve("ran"));

    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ran");
  });

  it("where nesting cannot be detected, fails after the wait limit instead of hanging", async () => {
    const clock = manualScheduler();
    const mutex = createTransactionMutex(blindGuard, {
      waitLimitMs: 1000,
      schedule: clock.schedule,
    });
    // A plain call made from inside a transaction: it waits for the transaction that waits for it.
    const outer = mutex.run(
      async () => await mutex.runStatement("insert", async () => await Promise.resolve(1)),
    );
    outer.catch(() => {});
    await settle();

    clock.fireAll();

    await expect(outer).rejects.toThrow("plain insert waited 1000 ms");
    await expect(
      mutex.runStatement("get", async () => await Promise.resolve("after")),
    ).resolves.toBe("after");
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

  it("keeps a plain insert from another context when the open transaction rolls back", async () => {
    const db = await open(make());
    const transact = await transactOf(db);
    const open$ = Promise.withResolvers<null>();
    const release = Promise.withResolvers<null>();

    const failing = transact(async (tx) => {
      await tx.insert(schema.siteSettings, setting("doomed"));
      open$.resolve(null);
      await release.promise;
      throw new Error("abort");
    });
    await open$.promise;
    // Another context writes while the transaction is open and awaiting: it must wait its turn.
    const outside = db.insert(schema.siteSettings, setting("outside"));
    await settleTicks();
    release.resolve(null);

    await expect(failing).rejects.toThrow("abort");
    await outside;
    expect(await db.get(schema.siteSettings, "doomed")).toBeNull();
    expect(await db.get(schema.siteSettings, "outside")).not.toBeNull();
  });

  it("fails a plain call made on the outer adapter inside a transaction at once, naming `tx`", async () => {
    const db = await open(make());
    const transact = await transactOf(db);

    await expect(
      transact(async () => await db.get(schema.siteSettings, "anything")),
    ).rejects.toThrow(
      "a plain get was called on the database inside its own transaction; use `tx`",
    );
    await expect(
      transact(async () => await db.insert(schema.siteSettings, setting("x"))),
    ).rejects.toThrow("a plain insert was called");
    // The failed transactions rolled back and released the queue.
    expect(await db.get(schema.siteSettings, "x")).toBeNull();
    await transact(async (tx) => await tx.insert(schema.siteSettings, setting("fine")));
    expect(await db.get(schema.siteSettings, "fine")).not.toBeNull();
  });

  it("keeps a later setup out of an open transaction", async () => {
    const db = await open(make());
    const transact = await transactOf(db);
    const opened = Promise.withResolvers<null>();
    const release = Promise.withResolvers<null>();
    const holder = transact(async (tx) => {
      await tx.insert(schema.siteSettings, setting("a"));
      opened.resolve(null);
      await release.promise;
      throw new Error("abort");
    });
    await opened.promise;
    let setupDone = false;
    const again = db.lifecycle?.setup({ config: {}, logger: silentLogger }).then(() => {
      setupDone = true;
    });
    await settleTicks();
    expect(setupDone).toBe(false);
    release.resolve(null);
    await expect(holder).rejects.toThrow("abort");
    await again;
    expect(setupDone).toBe(true);
    expect(await db.get(schema.siteSettings, "a")).toBeNull();
  });

  it("keeps health and teardown behind an open transaction, which can still use its connection", async () => {
    const db = await open(make());
    const transact = await transactOf(db);
    const opened = Promise.withResolvers<null>();
    const release = Promise.withResolvers<null>();
    const done: string[] = [];
    const holder = transact(async (tx) => {
      await tx.insert(schema.siteSettings, setting("a"));
      opened.resolve(null);
      await release.promise;
      // The connection is still open: neither lifecycle call ran, closed it or reset it.
      expect(await tx.get(schema.siteSettings, "a")).not.toBeNull();
    });
    await opened.promise;
    const health = db.lifecycle?.health().then((result) => {
      done.push("health");
      return result;
    });
    const teardown = db.lifecycle?.teardown().then(() => {
      done.push("teardown");
    });
    await settleTicks();
    expect(done).toEqual([]);

    release.resolve(null);
    await holder;
    expect(await health).toEqual({ ok: true });
    await teardown;
    expect(done).toEqual(["health", "teardown"]);
    expect(await db.lifecycle?.health()).toMatchObject({ ok: false });
  });

  it("serves every plain method, health and teardown, one after another with transactions", async () => {
    const db = await open(make());
    const transact = await transactOf(db);
    await db.insert(schema.siteSettings, setting("a"));
    await db.update(schema.siteSettings, "a", { value: "b" });
    expect((await db.get(schema.siteSettings, "a"))?.["value"]).toBe("b");
    expect(await db.list(schema.siteSettings)).toHaveLength(1);
    expect(await db.count(schema.siteSettings)).toBe(1);
    expect(await db.all?.(sql`SELECT id FROM site_settings`)).toHaveLength(1);
    expect(
      await db.updateWhere(schema.siteSettings, "a", { value: "c" }, sql`id = 'a'`),
    ).toMatchObject({ value: "c" });
    expect(await db.lifecycle?.health()).toEqual({ ok: true });
    await transact(async (tx) => {
      await tx.remove(schema.siteSettings, "a");
    });
    await db.remove(schema.siteSettings, "a");
    await db.lifecycle?.teardown();
    expect(await db.lifecycle?.health()).toMatchObject({ ok: false });
  });
});

const settleTicks = async (): Promise<void> => {
  for (let tick = 0; tick < 10; tick += 1) {
    // oxlint-disable-next-line no-await-in-loop -- let queued promise callbacks run
    await Promise.resolve();
  }
};

/** Every `./x.ts` module the entry point reaches, itself included. */
function reachable(entry: string): Map<string, string> {
  const here = import.meta.dirname;
  const seen = new Map<string, string>();
  const queue = [entry];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) continue;
    const source = readFileSync(join(here, file), "utf8");
    seen.set(file, source);
    for (const match of source.matchAll(/from "\.\/([\w-]+\.ts)"/gu)) {
      if (match[1] !== undefined) queue.push(match[1]);
    }
  }
  return seen;
}

describe("entry points that run on edge runtimes", () => {
  it.each(["d1.ts", "turso.ts"])("%s never reaches node:async_hooks", (entry) => {
    const offenders = [...reachable(entry)]
      .filter(([, source]) => source.includes(`from "node:async_hooks"`))
      .map(([file]) => file);

    expect(offenders).toEqual([]);
  });
});
