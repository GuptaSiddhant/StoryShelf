import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectInstalledAdapters } from "./detect-adapters.ts";

function makeTmp(): string {
  const dir = join(
    tmpdir(),
    `storyshelf-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("detectInstalledAdapters", () => {
  it("returns empty for missing package.json", () => {
    const dir = makeTmp();
    const result = detectInstalledAdapters(dir);
    expect(result).toEqual({});
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty for malformed package.json", () => {
    const dir = makeTmp();
    writeFileSync(join(dir, "package.json"), "not json");
    expect(detectInstalledAdapters(dir)).toEqual({});
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects sqlite database", () => {
    const dir = makeTmp();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { "@storyshelf/db-sqlite": "0.3.2" } }),
    );
    expect(detectInstalledAdapters(dir).database).toBe("sqlite");
    rmSync(dir, { recursive: true, force: true });
  });

  it("maps the legacy db-turso package to turso", () => {
    const dir = makeTmp();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: { "@storyshelf/db-sqlite": "0.3.2", "@storyshelf/db-turso": "0.3.2" },
      }),
    );
    expect(detectInstalledAdapters(dir).database).toBe("turso");
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects turso via the libsql peer dep", () => {
    const dir = makeTmp();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: { "@storyshelf/db-sqlite": "0.3.2", "@libsql/client": "^0.15.0" },
      }),
    );
    expect(detectInstalledAdapters(dir).database).toBe("turso");
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects better-sqlite3 via the better-sqlite3 dep", () => {
    const dir = makeTmp();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: { "@storyshelf/db-sqlite": "0.3.2", "better-sqlite3": "^12.0.0" },
      }),
    );
    expect(detectInstalledAdapters(dir).database).toBe("better-sqlite3");
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects d1 via the server.ts subpath import", () => {
    const dir = makeTmp();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { "@storyshelf/db-sqlite": "0.3.2" } }),
    );
    writeFileSync(
      join(dir, "server.ts"),
      'import { createD1Database } from "@storyshelf/db-sqlite/d1";',
    );
    expect(detectInstalledAdapters(dir).database).toBe("d1");
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects d1 from the src/index.ts scaffold layout", () => {
    const dir = makeTmp();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { "@storyshelf/db-sqlite": "0.3.2" } }),
    );
    mkdirSync(join(dir, "src"));
    writeFileSync(
      join(dir, "src", "index.ts"),
      'import { createD1Database } from "@storyshelf/db-sqlite/d1";',
    );
    expect(detectInstalledAdapters(dir).database).toBe("d1");
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects bun-sqlite via the server.ts subpath import", () => {
    const dir = makeTmp();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { "@storyshelf/db-sqlite": "0.3.2" } }),
    );
    writeFileSync(
      join(dir, "server.ts"),
      'import { createBunSqliteDatabase } from "@storyshelf/db-sqlite/bun-sqlite";',
    );
    expect(detectInstalledAdapters(dir).database).toBe("bun-sqlite");
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects s3 storage", () => {
    const dir = makeTmp();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { "@storyshelf/storage-s3": "0.3.2" } }),
    );
    expect(detectInstalledAdapters(dir).storage).toBe("s3");
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects azure blob storage", () => {
    const dir = makeTmp();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { "@storyshelf/storage-azure": "0.3.2" } }),
    );
    expect(detectInstalledAdapters(dir).storage).toBe("azure");
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects gcs storage", () => {
    const dir = makeTmp();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { "@storyshelf/storage-gcs": "0.3.2" } }),
    );
    expect(detectInstalledAdapters(dir).storage).toBe("gcs");
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects the git notification provider package", () => {
    const dir = makeTmp();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { "@storyshelf/notify-git": "0.3.2" } }),
    );
    expect(detectInstalledAdapters(dir).git).toBe("git");
    rmSync(dir, { recursive: true, force: true });
  });

  it("checks devDependencies as well", () => {
    const dir = makeTmp();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ devDependencies: { "@storyshelf/db-postgres": "0.3.2" } }),
    );
    expect(detectInstalledAdapters(dir).database).toBe("postgres");
    rmSync(dir, { recursive: true, force: true });
  });
});
