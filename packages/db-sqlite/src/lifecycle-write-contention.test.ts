import { createShelfLogger } from "@storyshelf/core/logger";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { replaceFencedReferences } from "./build-reference-lifecycle.ts";
import { createSqliteDatabase } from "./index.ts";
import { schema } from "./schema/index.ts";

/**
 * The lifecycle holds a write transaction on its own connection while its callback awaits (storage
 * I/O, timers). A plain write on the adapter's connection meanwhile must not freeze the event loop
 * waiting for that lock: the lifecycle could never reach its commit, so the write would fail with
 * "database is locked" after the whole busy timeout.
 */
const NOW = "2026-01-01T00:00:00.000Z";
let dir = "";
let path = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-lifecycle-contention-"));
  path = join(dir, "test.sqlite");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("plain write while the lifecycle holds the write lock across an await", () => {
  it("waits for the commit instead of failing with 'database is locked'", async () => {
    const db = createSqliteDatabase(path);
    await db.lifecycle?.setup({ config: {}, logger: createShelfLogger({ level: "silent" }) });
    try {
      await db.insert(schema.projects, {
        id: "p",
        name: "P",
        slug: "p",
        createdAt: NOW,
        updatedAt: NOW,
      });
      let entered!: () => void;
      const inside = new Promise<void>((resolve) => (entered = resolve));
      const holding = replaceFencedReferences(
        path,
        { projectId: "p", type: "baseline", id: "x" },
        0,
        [],
        async () => {
          entered();
          await delay(300);
        },
      );
      await inside;
      await expect(
        db.insert(schema.builds, {
          id: "b",
          projectId: "p",
          gitSha: "s",
          gitBranch: "main",
          status: "capturing",
          createdAt: NOW,
          updatedAt: NOW,
        } as never),
      ).resolves.toBeDefined();
      await holding;
    } finally {
      await db.lifecycle?.teardown();
    }
  }, 20_000);
});
