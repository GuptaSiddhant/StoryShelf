/**
 * `@storyshelf/observability` installs `@storyshelf/common` instead of all of core (#1334): neither its manifest
 * nor its source may reach core, Drizzle or pino again (the Node SDK entry included).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FORBIDDEN =
  /["'](?:@storyshelf\/core(?:\/[^"']*)?|drizzle-orm(?:\/[^"']*)?|pino(?:\/[^"']*)?)["']/u;
const SRC = import.meta.dirname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return /\.tsx?$/u.test(entry.name) && !path.endsWith("isolation.test.ts") ? [path] : [];
  });
}

describe("@storyshelf/observability isolation", () => {
  it("declares no core, drizzle-orm or pino dependency", () => {
    const manifest = JSON.parse(readFileSync(join(SRC, "../package.json"), "utf8")) as Record<
      string,
      Record<string, string> | undefined
    >;
    const declared = ["dependencies", "devDependencies", "peerDependencies"].flatMap((field) =>
      Object.keys(manifest[field] ?? {}),
    );
    expect(
      declared.filter((name) => ["@storyshelf/core", "drizzle-orm", "pino"].includes(name)),
    ).toEqual([]);
    expect(manifest["dependencies"]?.["@storyshelf/common"]).toBeDefined();
  });

  it("imports none of them", () => {
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(5);
    const offenders = files.filter((file) => FORBIDDEN.test(readFileSync(file, "utf8")));
    expect(offenders.map((file) => file.slice(SRC.length + 1))).toEqual([]);
  });
});
