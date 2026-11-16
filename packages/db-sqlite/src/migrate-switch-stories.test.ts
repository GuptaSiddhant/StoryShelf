/** `projects.switch_stories` (ADR 0052, decision 2) is an expand step: older rows read false. */
import { createShelfLogger } from "@storyshelf/core/logger";
import type { Project } from "@storyshelf/core/schema";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteDatabase } from "./index.ts";

const silent = createShelfLogger({ level: "silent" });
let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-switch-stories-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Open the adapter on the file (running its migrations), then close it. */
async function openOnce(path: string): Promise<void> {
  const db = createSqliteDatabase(path);
  await db.lifecycle?.setup({ config: {}, logger: silent });
  await db.lifecycle?.teardown();
}

describe("projects.switch_stories", () => {
  it("is added to an older database with a constant false default, twice without change", async () => {
    const path = join(dir, "old.db");
    const old = new DatabaseSync(path);
    old.exec(readFileSync(new URL("test-fixtures/pre-449.sql", import.meta.url), "utf8"));
    old.close();

    await openOnce(path);
    await openOnce(path);

    const check = new DatabaseSync(path, { readOnly: true });
    const column = (
      check.prepare("PRAGMA table_info(projects)").all() as {
        name: string;
        notnull: number;
        dflt_value: string;
      }[]
    ).find((col) => col.name === "switch_stories");
    expect(column).toMatchObject({ notnull: 1, dflt_value: "0" });
    const rows = check.prepare("SELECT switch_stories FROM projects").all();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row["switch_stories"] === 0)).toBe(true);
    check.close();
  });

  it("round-trips through the adapter and defaults to false", async () => {
    const db = createSqliteDatabase(":memory:");
    await db.lifecycle?.setup({ config: {}, logger: silent });
    const now = new Date().toISOString();
    await db.insert(db.tables.projects, {
      id: "p1",
      name: "P",
      slug: "p",
      createdAt: now,
      updatedAt: now,
    });
    expect(((await db.get(db.tables.projects, "p1")) as Project).switchStories).toBe(false);
    await db.update(db.tables.projects, "p1", { switchStories: true });
    expect(((await db.get(db.tables.projects, "p1")) as Project).switchStories).toBe(true);
    await db.lifecycle?.teardown();
  });
});
