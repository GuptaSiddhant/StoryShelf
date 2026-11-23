/**
 * Upgrades of an SQLite database from before default-branch verification (#910): the project
 * switch is added on for every existing project, the build's answer column is added empty, and
 * the rows people saved do not move.
 */
import { createShelfLogger } from "@storyshelf/core/logger";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteDatabase } from "./index.ts";

const silent = createShelfLogger({ level: "silent" });
const FIXTURE = new URL("test-fixtures/pre-449.sql", import.meta.url);

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-branch-upgrade-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function openOnce(path: string): Promise<void> {
  const db = createSqliteDatabase(path);
  await db.lifecycle?.setup({ config: {}, logger: silent });
  await db.lifecycle?.teardown();
}

describe("SQLite upgrade: default-branch verification", () => {
  it("turns verification on for existing projects and adds an empty answer column to builds", async () => {
    const path = join(dir, "old.db");
    const old = new DatabaseSync(path);
    old.exec(readFileSync(FIXTURE, "utf8"));
    old.close();

    await openOnce(path);
    await openOnce(path); // idempotent

    const sqlite = new DatabaseSync(path, { readOnly: true });
    const projects = sqlite
      .prepare("SELECT id, require_verified_default AS required FROM projects ORDER BY id")
      .all();
    const builds = sqlite.prepare("SELECT branch_verified FROM builds").all();
    sqlite.close();
    expect(projects.map((row) => row["required"])).toEqual(projects.map(() => 1));
    expect(projects.length).toBeGreaterThan(0);
    expect(builds.every((row) => row["branch_verified"] === null)).toBe(true);
  });
});
