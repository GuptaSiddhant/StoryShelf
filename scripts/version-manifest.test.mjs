import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildVersionManifest, MANIFEST_PATH, renderVersionManifest } from "./version-manifest.mjs";

const root = join(import.meta.dirname, "..");
const ADAPTERS = ["storage", "runner", "auth", "ai", "db"];

function manifestOf(dir) {
  return JSON.parse(readFileSync(join(root, "packages", dir, "package.json"), "utf8"));
}

describe("version manifest", () => {
  it("is up to date with every workspace package.json (run `nub run manifest`)", () => {
    assert.equal(readFileSync(MANIFEST_PATH, "utf8"), renderVersionManifest());
  });

  it("lists the dependencies a package exposes, at the version its package.json pins", () => {
    const runner = buildVersionManifest().packages["@storyshelf/runner"];
    assert.deepEqual(runner.exposed, {
      "playwright-core": manifestOf("runner").dependencies["playwright-core"],
    });
  });

  it("lists every published package once, with the peers of its package.json", () => {
    const manifest = buildVersionManifest();
    const dirs = readdirSync(join(root, "packages")).filter((d) => {
      try {
        return manifestOf(d).private !== true;
      } catch {
        return false;
      }
    });
    assert.deepEqual(
      Object.keys(manifest.packages).toSorted(),
      dirs.map((d) => manifestOf(d).name).toSorted(),
    );
    const storage = manifest.packages["@storyshelf/storage"];
    assert.deepEqual(storage.peers["@aws-sdk/lib-storage"], {
      range: "^3.700.0",
      optional: true,
      subpaths: ["./s3"],
    });
  });

  it("writes a @storyshelf peer as the package's own exact version", () => {
    const manifest = buildVersionManifest();
    for (const name of ADAPTERS.map((d) => manifestOf(d).name)) {
      const core = manifest.packages[name].peers["@storyshelf/core"];
      assert.deepEqual(core, { range: manifest.packages[name].version, optional: false });
    }
  });
});

describe("adapters take core as a peer", () => {
  for (const dir of ADAPTERS) {
    it(`${dir} lists @storyshelf/core as a peer and a dev dependency, never a dependency`, () => {
      const pkg = manifestOf(dir);
      assert.equal(pkg.dependencies?.["@storyshelf/core"], undefined);
      assert.equal(pkg.peerDependencies["@storyshelf/core"], "workspace:*");
      assert.equal(pkg.peerDependenciesMeta?.["@storyshelf/core"], undefined);
      assert.equal(pkg.devDependencies["@storyshelf/core"], "workspace:*");
    });
  }

  it("auth has no drizzle-orm peer (it reaches Drizzle through @storyshelf/core/orm)", () => {
    assert.equal(manifestOf("auth").peerDependencies["drizzle-orm"], undefined);
  });
});
