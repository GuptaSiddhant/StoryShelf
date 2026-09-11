import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { makeDatabase, makeStorage } from "../test-helpers/fake-adapters.ts";
import {
  AdapterLifecycleError,
  collectSetups,
  collectTeardowns,
  runAdapterSetups,
  runAdapterTeardowns,
} from "./setup.ts";

const silentLogger = pino({ level: "silent" });
const ctx = { config: {}, logger: silentLogger };

describe("adapter lifecycle runner", () => {
  it("collects no hooks from adapters without lifecycle", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    expect(collectSetups({ database: db, storage })).toEqual([]);
    expect(collectTeardowns({ database: db, storage })).toEqual([]);
  });

  it("runs setup hooks to ok when all pass", async () => {
    const { storage } = makeStorage();
    const database = {
      ...makeDatabase().db,
      lifecycle: {
        setup: async (): Promise<void> => {
          await Promise.resolve();
        },
        teardown: async (): Promise<void> => {
          await Promise.resolve();
        },
        health: async () => ({ ok: true }),
      },
    };
    const result = await runAdapterSetups(collectSetups({ database, storage }), ctx, silentLogger);
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("collects failures across adapters without starving the rest", async () => {
    const { storage } = makeStorage();
    const seen: string[] = [];
    const database = {
      ...makeDatabase().db,
      lifecycle: {
        setup: async (): Promise<void> => {
          await Promise.resolve();
          throw new Error("db down");
        },
        teardown: async (): Promise<void> => {
          await Promise.resolve();
        },
        health: async () => ({ ok: true }),
      },
    };
    const entries = collectSetups({ database, storage });
    entries.push({
      category: "storage",
      kind: "memory",
      name: "Second",
      run: async () => {
        await Promise.resolve();
        seen.push("second");
      },
    });
    const result = await runAdapterSetups(entries, ctx, silentLogger);
    expect(seen).toEqual(["second"]);
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      category: "database",
      kind: "memory",
      error: "db down",
    });
    expect(new AdapterLifecycleError("setup", result.failures).message).toContain(
      "database/memory",
    );
  });

  it("runs teardown hooks and reports teardown failures", async () => {
    const { storage } = makeStorage();
    const database = {
      ...makeDatabase().db,
      lifecycle: {
        setup: async (): Promise<void> => {
          await Promise.resolve();
        },
        teardown: async (): Promise<void> => {
          await Promise.resolve();
          throw new Error("stuck handle");
        },
        health: async () => ({ ok: true }),
      },
    };
    const result = await runAdapterTeardowns(
      collectTeardowns({ database, storage }),
      ctx,
      silentLogger,
    );
    expect(result.ok).toBe(false);
    expect(new AdapterLifecycleError("teardown", result.failures).message).toContain("database");
  });

  it("stringifies non-Error rejections", async () => {
    const { storage } = makeStorage();
    const database = {
      ...makeDatabase().db,
      lifecycle: {
        setup: async (): Promise<void> => {
          await Promise.resolve();
          // oxlint-disable-next-line no-throw-literal -- exercises non-Error rejection handling
          throw "plain string failure";
        },
        teardown: async (): Promise<void> => {
          await Promise.resolve();
        },
        health: async () => ({ ok: true }),
      },
    };
    const result = await runAdapterSetups(collectSetups({ database, storage }), ctx, silentLogger);
    expect(result.failures[0]?.error).toBe("plain string failure");
  });
});
