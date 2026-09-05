import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { makeDatabase, makeStorage } from "../test-helpers/fake-adapters.ts";
import {
  AdapterLifecycleError,
  collectCloses,
  collectInits,
  runAdapterCloses,
  runAdapterInits,
} from "./init.ts";

const silentLogger = pino({ level: "silent" });
const ctx = { config: {}, logger: silentLogger };

describe("adapter lifecycle runner", () => {
  it("collects no hooks from adapters without lifecycle", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    expect(collectInits({ database: db, storage })).toEqual([]);
    expect(collectCloses({ database: db, storage })).toEqual([]);
  });

  it("runs init hooks to ok when all pass", async () => {
    const { storage } = makeStorage();
    const database = {
      ...makeDatabase().db,
      lifecycle: {
        init: async (): Promise<void> => {
          await Promise.resolve();
        },
      },
    };
    const result = await runAdapterInits(collectInits({ database, storage }), ctx, silentLogger);
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("collects failures across adapters without starving the rest", async () => {
    const { storage } = makeStorage();
    const seen: string[] = [];
    const database = {
      ...makeDatabase().db,
      lifecycle: {
        init: async (): Promise<void> => {
          await Promise.resolve();
          throw new Error("db down");
        },
      },
    };
    const entries = collectInits({ database, storage });
    entries.push({
      category: "storage",
      kind: "memory",
      name: "Second",
      run: async () => {
        await Promise.resolve();
        seen.push("second");
      },
    });
    const result = await runAdapterInits(entries, ctx, silentLogger);
    expect(seen).toEqual(["second"]);
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      category: "database",
      kind: "memory",
      error: "db down",
    });
    expect(new AdapterLifecycleError("init", result.failures).message).toContain("database/memory");
  });

  it("runs close hooks and reports close failures", async () => {
    const { storage } = makeStorage();
    const database = {
      ...makeDatabase().db,
      lifecycle: {
        close: async (): Promise<void> => {
          await Promise.resolve();
          throw new Error("stuck handle");
        },
      },
    };
    const result = await runAdapterCloses(collectCloses({ database, storage }), ctx, silentLogger);
    expect(result.ok).toBe(false);
    expect(new AdapterLifecycleError("close", result.failures).message).toContain("database");
  });

  it("stringifies non-Error rejections", async () => {
    const { storage } = makeStorage();
    const database = {
      ...makeDatabase().db,
      lifecycle: {
        init: async (): Promise<void> => {
          await Promise.resolve();
          // oxlint-disable-next-line no-throw-literal -- exercises non-Error rejection handling
          throw "plain string failure";
        },
      },
    };
    const result = await runAdapterInits(collectInits({ database, storage }), ctx, silentLogger);
    expect(result.failures[0]?.error).toBe("plain string failure");
  });
});
