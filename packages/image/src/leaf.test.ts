import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** `@storyshelf/image` is a leaf: core depends on it, so it must never depend back (no cycles). */
const SCOPE = ["@story", "shelf/"].join("");

const here = new URL(".", import.meta.url);
const sources = readdirSync(here).filter((file) => file.endsWith(".ts") && file !== "leaf.test.ts");

describe("@storyshelf/image stays a leaf package", () => {
  it("declares no workspace dependency of any kind", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as Record<string, Record<string, string> | undefined>;
    const declared = [
      "dependencies",
      "peerDependencies",
      "devDependencies",
      "optionalDependencies",
    ].flatMap((field) => Object.keys(manifest[field] ?? {}));
    expect(declared.filter((name) => name.startsWith(SCOPE))).toEqual([]);
  });

  it.each(sources)("%s imports nothing from the workspace", (file) => {
    const text = readFileSync(new URL(file, here), "utf8");
    expect(text).not.toContain(SCOPE);
  });
});
