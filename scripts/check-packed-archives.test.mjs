import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkArchive, exportTargets, hasSourceCondition } from "./check-packed-archives.mjs";
import { materializeExports } from "./materialize-exports.mjs";

const files = ["package.json", "dist/index.mjs", "dist/index.d.mts", "dist/cli.js"];

describe("check-packed-archives", () => {
  it("accepts an archive whose exports, bin and types are all packed", () => {
    const manifest = {
      name: "a",
      types: "./dist/index.d.mts",
      bin: { a: "dist/cli.js" },
      exports: { ".": "./dist/index.mjs", "./package.json": "./package.json" },
    };
    assert.deepEqual(checkArchive(manifest, files), []);
  });

  it("reports a source condition, a missing target and a missing bin", () => {
    const manifest = {
      name: "a",
      bin: "dist/missing.js",
      exports: { ".": { source: "./src/index.ts", default: "./dist/gone.mjs" } },
    };
    const problems = checkArchive(manifest, files);
    assert.equal(problems.length, 4);
    assert.match(problems.join("\n"), /"source" condition/u);
    assert.match(problems.join("\n"), /\.\/src\/index\.ts is not in the tarball/u);
    assert.match(problems.join("\n"), /\.\/dist\/gone\.mjs is not in the tarball/u);
    assert.match(problems.join("\n"), /bin a -> dist\/missing\.js/u);
  });

  it("reports a source map and a missing types field", () => {
    const problems = checkArchive({ name: "a", types: "./dist/x.d.mts" }, [
      ...files,
      "dist/a.mjs.map",
    ]);
    assert.equal(problems.length, 2);
    assert.match(problems.join("\n"), /1 source maps ship/u);
  });

  it("walks nested conditions and ignores null and bare specifiers", () => {
    const targets = exportTargets(
      { ".": { types: "./a.d.ts", import: { default: "./a.js" } }, "./x": null },
      "exports",
    );
    assert.deepEqual(
      targets.map((t) => t.target),
      ["./a.d.ts", "./a.js"],
    );
    assert.equal(hasSourceCondition({ ".": { import: { source: "./s.ts" } } }), true);
    assert.equal(hasSourceCondition({ ".": "./a.js" }), false);
  });
});

describe("materialize-exports", () => {
  const pkg = {
    name: "a",
    exports: { ".": { source: "./src/i.ts", default: "./dist/i.mjs" } },
    publishConfig: { access: "public", exports: { ".": "./dist/i.mjs" } },
  };

  it("writes the dist-only map over exports, keeping the keys", () => {
    const next = materializeExports(pkg);
    assert.deepEqual(next.exports, { ".": "./dist/i.mjs" });
    assert.deepEqual(next.publishConfig, { access: "public" });
  });

  it("leaves a package without publishConfig.exports alone, and refuses changed keys", () => {
    assert.equal(materializeExports({ name: "b", exports: {} }), null);
    assert.throws(() => materializeExports({ ...pkg, exports: { "./x": "./x.js" } }), /same keys/u);
  });
});
