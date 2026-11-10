/**
 * An existing project with accessibility checks turned off keeps them off through every later open
 * of the adapter (#623): the upgrade adds a missing `run_a11y` column on, but never rewrites one.
 */
import { createShelfLogger } from "@storyshelf/core/logger";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createSqliteDatabase } from "./index.ts";

const silent = createShelfLogger({ level: "silent" });

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-a11y-upgrade-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function openOnce(path: string): Promise<void> {
  const db = createSqliteDatabase(path);
  await db.lifecycle?.setup({ config: {}, logger: silent });
  await db.lifecycle?.teardown();
}

describe("run_a11y on an existing SQLite database", () => {
  it("keeps a stored 0 across reopens", async () => {
    const path = join(dir, "shelf.db");
    await openOnce(path);
    const sqlite = new DatabaseSync(path);
    sqlite.exec(
      "INSERT INTO projects (id, name, slug, run_a11y, created_at, updated_at) VALUES ('off', 'Off', 'off', 0, 'now', 'now')",
    );
    sqlite.close();

    await openOnce(path);
    await openOnce(path);

    const check = new DatabaseSync(path);
    const row = check.prepare("SELECT run_a11y FROM projects WHERE id = 'off'").get();
    check.close();
    expect(row).toEqual({ run_a11y: 0 });
  });

  it("switches the setting on for a database that lacks the column", async () => {
    const path = join(dir, "old.db");
    await openOnce(path);
    const sqlite = new DatabaseSync(path);
    sqlite.exec(
      "INSERT INTO projects (id, name, slug, created_at, updated_at) VALUES ('p', 'P', 'p', 'now', 'now')",
    );
    sqlite.exec("ALTER TABLE projects DROP COLUMN run_a11y");
    sqlite.close();

    await openOnce(path);

    const check = new DatabaseSync(path);
    const row = check.prepare("SELECT run_a11y FROM projects WHERE id = 'p'").get();
    check.close();
    expect(row).toEqual({ run_a11y: 1 });
  });
});
