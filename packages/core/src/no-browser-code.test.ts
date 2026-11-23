import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ratchet: all browser code lives in `@storyshelf/runner`. Core, which also runs on a hosting-only
 * server, never imports Playwright or launches or connects a browser (#1338).
 */
const SRC = import.meta.dirname;
const BROWSER_USE = [
  /(?:from|import\()\s*["']playwright(?:-core)?(?:\/[^"']*)?["']/u,
  /\b(chromium|firefox|webkit)\s*\.\s*(launch|connect|connectOverCDP)\s*\(/u,
  /\bbrowser(Type)?\s*\.\s*(launch|connect)\s*\(/u,
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    const isSource = /\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name);
    return isSource && entry.name !== "no-browser-code.test.ts" ? [path] : [];
  });
}

describe("core holds no browser code", () => {
  it("imports no Playwright and never launches or connects a browser", () => {
    const offenders = sourceFiles(SRC).filter((file) => {
      const text = readFileSync(file, "utf8");
      return BROWSER_USE.some((pattern) => pattern.test(text));
    });
    expect(offenders.map((file) => file.slice(SRC.length + 1))).toEqual([]);
  });
});
