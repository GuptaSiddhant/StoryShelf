import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { createLocalStorage } from "@storyshelf/core/storage/local";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { appsConstructed } from "./app-count.ts";
import type { ShelfAppMode } from "./app-types.ts";
import { createShelfApp } from "./index.tsx";

/** An app whose storage setup is counted: the database's setup is the migrations. */
function countedApp(mode?: ShelfAppMode): {
  app: ReturnType<typeof createShelfApp>;
  storageSetups: () => number;
} {
  const dir = mkdtempSync(join(tmpdir(), "storyshelf-modes-"));
  const local = createLocalStorage(dir);
  const setup = vi.fn(async (ctx: Parameters<NonNullable<typeof local.lifecycle>["setup"]>[0]) => {
    await local.lifecycle?.setup(ctx);
  });
  const storage: StorageAdapter = {
    ...local,
    lifecycle: { ...local.lifecycle!, setup },
  };
  const app = createShelfApp(
    {
      database: createSqliteDatabase(join(dir, "shelf.db")),
      storage,
      logger: pino({ level: "silent" }),
      config: { scratchDir: dir },
    },
    mode === undefined ? undefined : { mode },
  );
  return { app, storageSetups: () => setup.mock.calls.length };
}

describe("createShelfApp modes", () => {
  it("counts every app it constructs", () => {
    const before = appsConstructed();
    countedApp("tool");
    countedApp();
    expect(appsConstructed()).toBe(before + 2);
  });

  it("serve (the default) sets every adapter up in the background", async () => {
    const { app, storageSetups } = countedApp();
    expect(app.lifecycle.mode).toBe("serve");
    await app.lifecycle.setup();
    expect(storageSetups()).toBeGreaterThan(0);
    await app.lifecycle.teardown();
  });

  it("migrate sets the database up and nothing else", async () => {
    const { app, storageSetups } = countedApp("migrate");
    expect(app.lifecycle.mode).toBe("migrate");
    await app.lifecycle.setup();
    expect((await app.lifecycle.ready).ok).toBe(true);
    expect(storageSetups()).toBe(0);
    await app.lifecycle.teardown();
  });

  it("tool sets nothing up and refuses setup()", async () => {
    const { app, storageSetups } = countedApp("tool");
    expect(app.lifecycle.mode).toBe("tool");
    expect((await app.lifecycle.ready).ok).toBe(true);
    await expect(app.lifecycle.setup()).rejects.toThrow(/never sets its adapters up/u);
    expect(storageSetups()).toBe(0);
    await app.lifecycle.teardown();
  });
});
