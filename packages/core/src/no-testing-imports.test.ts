import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ratchet for the hosting/testing line (#1361, #1363): hosting-side modules must not import
 * testing-side ones, type imports included. `ALLOWED` lists today's violations (#1364 and #1365
 * empty it); a new violation fails, and so does an entry that no longer occurs.
 */
const SRC = import.meta.dirname;

/** Folders, and files under `capture/`, that belong to hosting. Paths are relative to `src/`. */
const HOSTING = [
  "models/",
  "adapters/",
  "retention/",
  "integrations/",
  "schema/",
  "utils/",
  "storage/",
  "db/",
  "orm/",
  "lifecycle/",
  "jobs/",
  "publish/",
  "build-state/",
  "catalog/",
  // Until #1364 moves them out of capture/:
  "capture/db-queue/",
  "capture/consumer/",
  "capture/job-lease",
  "capture/publish/",
  "capture/statics",
  "capture/content-uses",
  "capture/scratch",
  "capture/build-state/",
  "capture/catalog/",
];
/** Under a hosting prefix, but testing. */
const TESTING_EXCEPTIONS = ["capture/consumer/capture-handler"];
const TESTING = ["capture/", "diff/", "insights/"];

/** Today's violations, one `from → to` per line (paths without extension, relative to `src/`). */
const ALLOWED: string[] = [
  "adapters/capture-runner → capture/adapter",
  "capture/consumer/index → capture/consumer/capture-handler",
  "capture/consumer/startup → diff/index",
  "capture/consumer/types → capture/consumer/capture-handler",
];

const IMPORT =
  /(?:\b(?:import|export)\b[^"';]*?\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](\.{1,2}\/[^"']*)["']/gu;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__fixtures__" ? [] : sourceFiles(path);
    }
    return /\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name) ? [path] : [];
  });
}

const rel = (path: string): string => relative(SRC, path).split(sep).join("/");
const strip = (path: string): string => path.replace(/\.(?:[cm]?[jt]sx?)$/u, "");
const under = (path: string, prefixes: string[]): boolean =>
  prefixes.some((prefix) => path.startsWith(prefix));

function isTesting(path: string): boolean {
  if (TESTING_EXCEPTIONS.some((file) => path.startsWith(file))) {
    return true;
  }
  return !under(path, HOSTING) && under(path, TESTING);
}

const isHosting = (path: string): boolean => under(path, HOSTING) && !isTesting(path);

function violations(): string[] {
  const found = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const from = strip(rel(file));
    if (!isHosting(from)) {
      continue;
    }
    for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
      // A directory import (`../capture`) is its index, so give it a trailing slash.
      const target = strip(rel(resolve(dirname(file), match[1] ?? "")));
      if (isTesting(target) || isTesting(`${target}/`)) {
        found.add(`${from} → ${target}`);
      }
    }
  }
  // oxlint-disable-next-line unicorn/no-array-sort, typescript/require-array-sort-compare -- toSorted not available in type-aware lint lib
  return [...found].sort();
}

describe("hosting code stays free of testing code", () => {
  const found = violations();

  it("has no hosting module importing capture/ or diff/ beyond the allowlist", () => {
    expect(found.filter((line) => !ALLOWED.includes(line))).toEqual([]);
  });

  it("has no allowlist entry that no longer occurs", () => {
    expect(ALLOWED.filter((line) => !found.includes(line))).toEqual([]);
  });
});
