/** `content_uses.size_bytes` (#875) is an expand step (ADR 0053): older rows read null. */
import { createShelfLogger } from "@storyshelf/core/logger";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteDatabase } from "./index.ts";

const silent = createShelfLogger({ level: "silent" });
let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-content-size-"));
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

describe("content_uses.size_bytes", () => {
  it("is added nullable to a database that has the table without it, keeping its rows, twice without change", async () => {
    const path = join(dir, "old.db");
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE content_uses (
      build_id TEXT NOT NULL, content_hash TEXT NOT NULL, project_id TEXT NOT NULL,
      created_at TEXT NOT NULL, released_at TEXT, collecting_at TEXT, claim_token TEXT,
      PRIMARY KEY (build_id, content_hash));
      INSERT INTO content_uses (build_id, content_hash, project_id, created_at)
      VALUES ('b1', '${"a".repeat(64)}', 'p1', '2026-01-01T00:00:00.000Z')`);
    old.close();

    await openOnce(path);
    await openOnce(path);

    const check = new DatabaseSync(path, { readOnly: true });
    const column = (
      check.prepare("PRAGMA table_info(content_uses)").all() as { name: string; notnull: number }[]
    ).find((col) => col.name === "size_bytes");
    expect(column).toMatchObject({ notnull: 0 });
    const rows = check.prepare("SELECT size_bytes FROM content_uses").all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["size_bytes"]).toBeNull();
    check.close();
  });
});
