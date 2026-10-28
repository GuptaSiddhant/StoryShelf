import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { previewVersion, stampPreviewPackages } from "./prepare-preview.mjs";

test("preview version matches pkg.pr.new's seven-character commit version", () => {
  assert.equal(previewVersion("abcdef012345678901234567890123456789abcd"), "0.0.0-preview-abcdef0");
  assert.throws(() => previewVersion("bad"));
});

test("only public package versions are stamped before building", () => {
  const root = mkdtempSync(join(tmpdir(), "storyshelf-preview-"));
  try {
    for (const [dir, manifest] of Object.entries({
      public: { name: "@storyshelf/core", version: "0.7.0", dependencies: { x: "workspace:*" } },
      private: { name: "private", version: "1.0.0", private: true },
    })) {
      mkdirSync(join(root, dir));
      writeFileSync(join(root, dir, "package.json"), JSON.stringify(manifest));
    }
    assert.equal(stampPreviewPackages(root, "0.0.0-preview-abcdef0"), 1);
    const publicPkg = JSON.parse(readFileSync(join(root, "public", "package.json"), "utf8"));
    const privatePkg = JSON.parse(readFileSync(join(root, "private", "package.json"), "utf8"));
    assert.equal(publicPkg.version, "0.0.0-preview-abcdef0");
    assert.equal(publicPkg.dependencies.x, "workspace:*");
    assert.equal(privatePkg.version, "1.0.0");
    assert.throws(() => stampPreviewPackages(root, "0.7.0"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
