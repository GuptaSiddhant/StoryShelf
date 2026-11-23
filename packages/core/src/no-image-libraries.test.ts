import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ratchet: image work lives in `@storyshelf/runner/images`, which owns `pngjs` and `pixelmatch`
 * and peers on `sharp`. Core keeps only the `ImageEngine` contract, so no shipped core module
 * imports an image library and a hosting-only install never needs one (#1365).
 */
const SRC = import.meta.dirname;
const IMAGE_LIBRARY = /(?:from|import\()\s*["'](?:pngjs|pixelmatch|sharp)(?:\/[^"']*)?["']/u;
/** Core's own tests compare real PNGs through this double; nothing shipped imports it. */
const TEST_DOUBLE = "test-helpers/png-image-engine.ts";

const rel = (path: string): string => relative(SRC, path).split(sep).join("/");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name) ? [path] : [];
  });
}

describe("core holds no image library", () => {
  const shipped = sourceFiles(SRC).filter((file) => rel(file) !== TEST_DOUBLE);

  it("imports no pngjs, pixelmatch or sharp outside tests", () => {
    const offenders = shipped.filter((file) => IMAGE_LIBRARY.test(readFileSync(file, "utf8")));
    expect(offenders.map((file) => rel(file))).toEqual([]);
  });

  it("keeps the test double out of shipped code", () => {
    const importers = shipped.filter((file) =>
      readFileSync(file, "utf8").includes("png-image-engine"),
    );
    expect(importers.map((file) => rel(file))).toEqual([]);
  });
});
