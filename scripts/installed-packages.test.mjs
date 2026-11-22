import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { findInstalled } from "./installed-packages.mjs";

const roots = [];

function tree(...packagePaths) {
  const root = mkdtempSync(join(tmpdir(), "installed-packages-"));
  roots.push(root);
  for (const path of packagePaths) {
    mkdirSync(join(root, path), { recursive: true });
    writeFileSync(join(root, path, "package.json"), "{}");
  }
  return root;
}

describe("findInstalled", () => {
  after(() => {
    for (const root of roots) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  const FORBIDDEN = ["@storyshelf/core", "drizzle-orm", "pino"];

  it("passes a clean tree", () => {
    const root = tree(
      "node_modules/@storyshelf/common",
      "node_modules/@storyshelf/mcp",
      "node_modules/zod",
    );
    assert.deepEqual(findInstalled(root, FORBIDDEN), []);
  });

  it("finds a top-level, a scoped and a nested copy", () => {
    const root = tree(
      "node_modules/pino",
      "node_modules/@storyshelf/core",
      "node_modules/@storyshelf/mcp/node_modules/drizzle-orm",
      "node_modules/a/node_modules/b/node_modules/pino",
    );
    assert.deepEqual(findInstalled(root, FORBIDDEN).toSorted(), [
      "node_modules/@storyshelf/core",
      "node_modules/@storyshelf/mcp/node_modules/drizzle-orm",
      "node_modules/a/node_modules/b/node_modules/pino",
      "node_modules/pino",
    ]);
  });

  it("does not match a package that only shares a prefix", () => {
    const root = tree(
      "node_modules/pino-abstract-transport",
      "node_modules/@storyshelf/core-extra",
    );
    assert.deepEqual(findInstalled(root, FORBIDDEN), []);
  });

  it("returns nothing for a project with no node_modules", () => {
    assert.deepEqual(findInstalled(tree(), FORBIDDEN), []);
  });
});
