import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { previewVersion, stampPreviewPackages } from "./prepare-preview.mjs";

function createFixture(root) {
  for (const [dir, manifest] of Object.entries({
    public: { name: "@storyshelf/core", version: "0.7.0", dependencies: { x: "workspace:*" } },
    private: { name: "private", version: "1.0.0", private: true },
  })) {
    mkdirSync(join(root, dir));
    writeFileSync(join(root, dir, "package.json"), JSON.stringify(manifest));
  }
}

function readPackage(root, dir) {
  return JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
}

test("preview version matches pkg.pr.new's seven-character commit version", () => {
  assert.equal(previewVersion("abcdef012345678901234567890123456789abcd"), "0.0.0-preview-abcdef0");
  assert.throws(() => previewVersion("bad"));
});

test("only public package versions are stamped before building", () => {
  const root = mkdtempSync(join(tmpdir(), "storyshelf-preview-"));
  try {
    createFixture(root);
    assert.equal(stampPreviewPackages(root, "0.0.0-preview-abcdef0"), 1);
    assert.equal(readPackage(root, "public").version, "0.0.0-preview-abcdef0");
    assert.equal(readPackage(root, "public").dependencies.x, "workspace:*");
    assert.equal(readPackage(root, "private").version, "1.0.0");
    assert.throws(() => stampPreviewPackages(root, "0.7.0"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
