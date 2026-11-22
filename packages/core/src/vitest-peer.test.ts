/**
 * `vitest` is an optional peer of core (#1332): only `./test-helpers` may resolve it. No other export
 * may reach a module that imports it, or an install without vitest would fail at runtime.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGE_DIR = join(import.meta.dirname, "..");
const SRC = join(PACKAGE_DIR, "src");
const SPECIFIER = /(?:from|import)\s*\(?\s*["']([^"']+)["']/gu;
const VITEST = /["']vitest(?:\/[^"']*)?["']/u;

const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8")) as {
  exports: Record<string, { source?: string } | string>;
  peerDependenciesMeta: Record<string, { optional?: boolean }>;
};

function importsOf(file: string): { vitest: boolean; relative: string[] } {
  const text = readFileSync(file, "utf8");
  const relatives = [...text.matchAll(SPECIFIER)]
    .map((match) => match[1] ?? "")
    .filter((specifier) => specifier.startsWith("."))
    .map((specifier) => resolve(dirname(file), specifier))
    .filter((target) => existsSync(target) && !target.endsWith("/"));
  return { vitest: VITEST.test(text), relative: relatives };
}

/** Every file reachable from `entry` by relative imports, and the ones among them importing vitest. */
function reachableVitestImporters(entry: string): string[] {
  const seen = new Set<string>();
  const hits: string[] = [];
  const queue = [entry];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file) || !/\.tsx?$/u.test(file)) continue;
    seen.add(file);
    const found = importsOf(file);
    if (found.vitest) hits.push(file.slice(SRC.length + 1));
    queue.push(...found.relative);
  }
  return hits;
}

describe("vitest as an optional peer", () => {
  it("is declared optional", () => {
    expect(pkg.peerDependenciesMeta["vitest"]?.optional).toBe(true);
  });

  it("is resolved only through ./test-helpers", () => {
    const offenders: Record<string, string[]> = {};
    for (const [subpath, target] of Object.entries(pkg.exports)) {
      if (subpath === "./test-helpers" || typeof target === "string" || !target.source) continue;
      const hits = reachableVitestImporters(join(PACKAGE_DIR, target.source));
      if (hits.length > 0) offenders[subpath] = hits;
    }
    expect(offenders).toEqual({});
  });

  it("is imported by test-helpers at all (the check can fail)", () => {
    expect(reachableVitestImporters(join(SRC, "test-helpers/index.ts")).length).toBeGreaterThan(0);
  });
});
