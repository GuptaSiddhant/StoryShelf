import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = import.meta.dirname;
const ENGINE_IMPORT = /from\s+["']@storyshelf\/auth["']/u;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return sourceFiles(full);
    }
    return /\.tsx?$/u.test(entry) && !/\.test\.tsx?$/u.test(entry) ? [full] : [];
  });
}

describe("auth engine boundary", () => {
  it("never imports @storyshelf/auth from shipped app source (use @storyshelf/core/auth)", () => {
    const offenders = sourceFiles(SRC).filter((file) =>
      ENGINE_IMPORT.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
