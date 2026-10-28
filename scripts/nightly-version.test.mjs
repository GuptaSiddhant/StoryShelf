import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { nightlyVersion, stampNightlyPackages } from "./nightly-version.mjs";

test("nightly version uses the run creation date in UTC", () => {
  assert.equal(nightlyVersion("2026-10-28T00:01:00Z"), "0.0.0-2026102801");
  assert.equal(nightlyVersion("2026-10-28T00:30:00+02:00"), "0.0.0-2026102701");
  assert.throws(() => nightlyVersion("not-a-date"));
});

test("only public packages receive the shared nightly version", () => {
  const root = mkdtempSync(join(tmpdir(), "storyshelf-nightly-"));
  try {
    for (const [dir, manifest] of Object.entries({
      public: { name: "@storyshelf/core", version: "0.7.0", dependencies: { x: "workspace:*" } },
      private: { name: "private", version: "1.0.0", private: true },
    })) {
      mkdirSync(join(root, dir));
      writeFileSync(join(root, dir, "package.json"), JSON.stringify(manifest));
    }
    assert.equal(stampNightlyPackages(root, "0.0.0-2026102801"), 1);
    const publicPkg = JSON.parse(readFileSync(join(root, "public", "package.json"), "utf8"));
    const privatePkg = JSON.parse(readFileSync(join(root, "private", "package.json"), "utf8"));
    assert.equal(publicPkg.version, "0.0.0-2026102801");
    assert.equal(publicPkg.dependencies.x, "workspace:*");
    assert.equal(privatePkg.version, "1.0.0");
    assert.throws(() => stampNightlyPackages(root, "0.7.0"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("workspace dependencies are pinned to the same nightly version before publishing", async () => {
  const { cpSync } = await import("node:fs");
  const { spawnSync } = await import("node:child_process");
  const root = mkdtempSync(join(tmpdir(), "storyshelf-nightly-manifests-"));
  try {
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "packages"));
    cpSync(join(import.meta.dirname, "..", "package.json"), join(root, "package.json"));
    cpSync(
      join(import.meta.dirname, "rewrite-workspace-protocol.mjs"),
      join(root, "scripts", "rewrite-workspace-protocol.mjs"),
    );
    for (const dir of ["core", "app"]) {
      mkdirSync(join(root, "packages", dir));
      cpSync(
        join(import.meta.dirname, "..", "packages", dir, "package.json"),
        join(root, "packages", dir, "package.json"),
      );
    }
    const version = "0.0.0-2026102801";
    stampNightlyPackages(join(root, "packages"), version);
    const rewrite = spawnSync(
      process.execPath,
      [join(root, "scripts", "rewrite-workspace-protocol.mjs")],
      { encoding: "utf8" },
    );
    assert.equal(rewrite.status, 0, rewrite.stderr);
    const app = JSON.parse(readFileSync(join(root, "packages", "app", "package.json"), "utf8"));
    assert.equal(app.version, version);
    assert.equal(app.dependencies["@storyshelf/core"], version);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
