/** `push_subscriptions` (ADR 0048) arrives by expand step: an old database gains it, rows stay. */
import { createShelfLogger } from "@storyshelf/core/logger";
import { PushSubscriptionModel } from "@storyshelf/core/models";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteDatabase } from "./index.ts";

const silent = createShelfLogger({ level: "silent" });
let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-push-upgrade-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("push_subscriptions on SQLite", () => {
  it("appears on an existing database, keeps its rows and survives a second open", async () => {
    const path = join(dir, "old.db");
    const old = new DatabaseSync(path);
    old.exec(readFileSync(new URL("test-fixtures/pre-449.sql", import.meta.url), "utf8"));
    const before = old.prepare("SELECT count(*) AS n FROM users").get() as { n: number };
    old.close();
    const open = async () => {
      const db = createSqliteDatabase(path);
      await db.lifecycle?.setup({ config: {}, logger: silent });
      return db;
    };
    const first = await open();
    expect(await first.count(first.tables.users)).toBe(before.n);
    const user = (await first.list(first.tables.users, { limit: 1 }))[0] as { id: string };
    await new PushSubscriptionModel(first).add(user.id, {
      endpoint: "https://push.test/old",
      p256dh: "k",
      auth: "a",
    });
    await first.lifecycle?.teardown();
    const second = await open();
    expect(await second.count(second.tables.users)).toBe(before.n);
    expect(await second.count(second.tables.pushSubscriptions)).toBe(1);
    await second.lifecycle?.teardown();
  });

  it("is created on a fresh database", async () => {
    const db = createSqliteDatabase(":memory:");
    await db.lifecycle?.setup({ config: {}, logger: silent });
    expect(await db.count(db.tables.pushSubscriptions)).toBe(0);
    await db.lifecycle?.teardown();
  });
});
