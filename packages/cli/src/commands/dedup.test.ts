import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashFiles, walkFiles, type HashedFile } from "./dedup.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-dedup-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("walkFiles", () => {
  it("lists files relative to buildDir", async () => {
    const buildDir = join(dir, "static");
    mkdirSync(join(buildDir, "assets"), { recursive: true });
    writeFileSync(join(buildDir, "index.html"), "<html>");
    writeFileSync(join(buildDir, "assets", "app.js"), "js");
    const files = await walkFiles(dir, "static");
    expect(files.toSorted()).toEqual(["assets/app.js", "index.html"]);
  });

  it("handles empty directory", async () => {
    mkdirSync(join(dir, "empty"), { recursive: true });
    const files = await walkFiles(dir, "empty");
    expect(files).toEqual([]);
  });
});

describe("hashFiles", () => {
  it("hashes content with sha256 and reports size", async () => {
    const buildDir = join(dir, "static");
    mkdirSync(buildDir, { recursive: true });
    writeFileSync(join(buildDir, "a.txt"), "hello");
    writeFileSync(join(buildDir, "b.txt"), "world");
    const files = await walkFiles(dir, "static");
    const hashed = await hashFiles(dir, "static", files);
    const map = Object.fromEntries(hashed.map((h) => [h.rel, h]));
    expect(entry(map, "a.txt").hash).toBe(
      createHash("sha256").update(Buffer.from("hello")).digest("hex"),
    );
    expect(entry(map, "a.txt").size).toBe(5);
    expect(entry(map, "b.txt").hash).toBe(
      createHash("sha256").update(Buffer.from("world")).digest("hex"),
    );
  });

  it("produces stable hash for identical content", async () => {
    const buildDir = join(dir, "static");
    mkdirSync(buildDir, { recursive: true });
    writeFileSync(join(buildDir, "x.txt"), "same");
    const h1 = await hashFiles(dir, "static", ["x.txt"]);
    const h2 = await hashFiles(dir, "static", ["x.txt"]);
    expect(entryByIndex(h1, 0).hash).toBe(entryByIndex(h2, 0).hash);
  });
});

/** Look up a hashed file by relative path, failing loudly when absent. */
function entry(map: Record<string, HashedFile>, rel: string): HashedFile {
  const found = map[rel];
  if (!found) {
    throw new Error(`missing hashed file: ${rel}`);
  }
  return found;
}

/** Look up a hashed file by index, failing loudly when absent. */
function entryByIndex(hashed: HashedFile[], index: number): HashedFile {
  const found = hashed[index];
  if (!found) {
    throw new Error(`missing hashed file at index ${index}`);
  }
  return found;
}
