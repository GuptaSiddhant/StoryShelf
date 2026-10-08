import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureDbDir } from "./ensure-db-dir.ts";
import { createSqliteDatabase } from "./index.ts";

let root = "";
afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("ensureDbDir", () => {
  it("creates missing parent directories", () => {
    root = mkdtempSync(join(tmpdir(), "ss-db-dir-"));
    const file = join(root, "a", "b", "shelf.db");
    ensureDbDir(file);
    expect(existsSync(join(root, "a", "b"))).toBe(true);
  });

  it("is a no-op for an existing directory", () => {
    root = mkdtempSync(join(tmpdir(), "ss-db-dir-"));
    expect(() => {
      ensureDbDir(join(root, "shelf.db"));
    }).not.toThrow();
  });

  it("leaves in-memory and file: URI databases alone", () => {
    expect(() => {
      ensureDbDir(":memory:");
      ensureDbDir("");
      ensureDbDir("file:shelf.db?mode=memory");
    }).not.toThrow();
  });
});

describe("createSqliteDatabase on a fresh directory", () => {
  it("opens a database whose directory does not exist yet", async () => {
    root = mkdtempSync(join(tmpdir(), "ss-db-dir-"));
    const file = join(root, "data", "shelf.db");
    const db = createSqliteDatabase(file);
    expect(existsSync(file)).toBe(true);
    await db.lifecycle?.teardown();
  });
});
