import { createShelfLogger } from "@storyshelf/core/logger";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteDatabase } from "./index.ts";
import { BUSY_WAIT_MS, createExecutors } from "./proxy-executors.ts";

function memory(): DatabaseSync {
  const sqlite = new DatabaseSync(":memory:", { returnArrays: true });
  sqlite.exec("CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER)");
  sqlite.exec("INSERT INTO t VALUES ('a', 1), ('b', 2)");
  return sqlite;
}

describe("createExecutors", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("answers in the row mode asked for, arrays by default", async () => {
    const executors = createExecutors(memory());
    const select = "SELECT id, n FROM t ORDER BY id";
    expect(await executors.all(select, [])).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
    expect(await executors.all(select, [], "array")).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
    expect(await executors.all(select, [], "object")).toEqual([
      { id: "a", n: 1 },
      { id: "b", n: 2 },
    ]);
  });

  it("answers one row for get, and undefined on a miss", async () => {
    const executors = createExecutors(memory());
    expect(await executors.get("SELECT id, n FROM t WHERE id = ?", ["b"], "array")).toEqual([
      "b",
      2,
    ]);
    expect(await executors.get("SELECT id, n FROM t WHERE id = ?", ["b"], "object")).toEqual({
      id: "b",
      n: 2,
    });
    expect(await executors.get("SELECT id FROM t WHERE id = ?", ["z"], "array")).toBeUndefined();
  });

  it("keeps the connection's own statements on arrays", async () => {
    const sqlite = memory();
    await createExecutors(sqlite).all("SELECT id FROM t", [], "object");
    expect(sqlite.prepare("SELECT id FROM t WHERE id = 'a'").get()).toEqual(["a"]);
  });

  it("runs a write and answers the run result", async () => {
    const sqlite = memory();
    const result = (await createExecutors(sqlite).run("UPDATE t SET n = n + 1", [])) as {
      changes: number;
    };
    expect(result.changes).toBe(2);
    expect(sqlite.prepare("SELECT n FROM t WHERE id = 'a'").get()).toEqual([2]);
  });

  it("waits for another connection's write lock, then writes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shelf-executors-"));
    dirs.push(dir);
    const path = join(dir, "db.sqlite");
    const holder = new DatabaseSync(path);
    holder.exec("PRAGMA journal_mode = WAL; CREATE TABLE t (id TEXT PRIMARY KEY)");
    const waiter = new DatabaseSync(path, { returnArrays: true });
    waiter.exec("PRAGMA busy_timeout = 0");
    holder.exec("BEGIN IMMEDIATE; INSERT INTO t VALUES ('held')");
    const write = createExecutors(waiter, BUSY_WAIT_MS).run("INSERT INTO t VALUES ('waited')", []);
    setTimeout(() => holder.exec("COMMIT"), 50);
    await write;
    expect(waiter.prepare("SELECT id FROM t ORDER BY id").all()).toEqual([["held"], ["waited"]]);
    holder.close();
    waiter.close();
  });

  it("fails at once on a lock when it may not wait", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shelf-executors-"));
    dirs.push(dir);
    const path = join(dir, "db.sqlite");
    const holder = new DatabaseSync(path);
    holder.exec("PRAGMA journal_mode = WAL; CREATE TABLE t (id TEXT PRIMARY KEY)");
    const waiter = new DatabaseSync(path);
    waiter.exec("PRAGMA busy_timeout = 0");
    holder.exec("BEGIN IMMEDIATE; INSERT INTO t VALUES ('held')");
    await expect(
      createExecutors(waiter).run("INSERT INTO t VALUES ('waited')", []),
    ).rejects.toThrow("database is locked");
    holder.exec("COMMIT");
    holder.close();
    waiter.close();
  });
});

describe("createSqliteDatabase over the executors", () => {
  it("maps the rows Drizzle reads back to the column types: booleans stay booleans", async () => {
    const adapter = createSqliteDatabase(":memory:");
    await adapter.lifecycle?.setup({ config: {}, logger: createShelfLogger({ level: "silent" }) });
    const now = "2026-11-21T10:00:00.000Z";
    const table = adapter.tables.projects;
    const inserted = (await adapter.insert(table, {
      id: "p1",
      name: "Project",
      slug: "project",
      createdAt: now,
      updatedAt: now,
    } as never)) as Record<string, unknown>;
    const read = (await adapter.get(table, "p1")) as Record<string, unknown> | null;
    const [listed] = (await adapter.list(table)) as Record<string, unknown>[];
    for (const row of [inserted, read, listed]) {
      expect(row?.["runA11y"]).toBe(true);
      expect(row?.["executePlay"]).toBe(false);
      expect(row?.["createdAt"]).toBe(now);
    }
    expect(await adapter.count(table)).toBe(1);
    await adapter.lifecycle?.teardown();
  });
});
