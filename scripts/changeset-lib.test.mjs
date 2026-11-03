import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkChangeset, mergeChangelog, parseChangeset, renderEntries } from "./changeset-lib.mjs";

const CHANGELOG = `# Changelog

Intro.

## Unreleased

**Added: first.** One.

**Fixed: second.** Two.

## 0.8.0 — Older (2026-11-02)

**Fixed: old.** Old.

## 0.7.0 — Oldest (2026-10-25)

**Added: oldest.** Oldest.
`;

describe("parseChangeset", () => {
  it("reads packages, bumps and the body", () => {
    const parsed = parseChangeset(
      "---\n\"@storyshelf/core\": minor\n'storyshelf': patch\n---\n\n**Fixed: x.** Y.\n",
      "a.md",
    );
    assert.deepEqual(parsed, {
      file: "a.md",
      releases: [
        { name: "@storyshelf/core", bump: "minor" },
        { name: "storyshelf", bump: "patch" },
      ],
      body: "**Fixed: x.** Y.",
    });
  });

  it("accepts an empty changeset", () => {
    assert.deepEqual(parseChangeset("---\n---\n", "e.md").releases, []);
  });

  it("refuses a file without front matter or with an unknown bump", () => {
    assert.throws(() => parseChangeset("just text", "x.md"), /front matter/u);
    assert.throws(() => parseChangeset('---\n"a": huge\n---\nbody', "x.md"), /cannot read/u);
  });
});

const make = (file, bump, body) => ({ file, releases: [{ name: "p", bump }], body });

describe("renderEntries", () => {
  it("orders by the largest bump, then by file name, and drops empty bodies", () => {
    assert.deepEqual(
      renderEntries([
        make("b.md", "patch", "B"),
        make("a.md", "patch", "A"),
        make("c.md", "major", "C"),
        make("d.md", "minor", ""),
        make("e.md", "minor", "E"),
      ]),
      ["C", "E", "A", "B"],
    );
  });
});

describe("mergeChangelog", () => {
  it("releases the Unreleased prose and the entries under a new section above the older ones", () => {
    const merged = mergeChangelog(CHANGELOG, {
      version: "0.9.0",
      date: "2026-11-10",
      entries: ["**Changed: new.** New."],
    });
    assert.ok(!merged.includes("## Unreleased"));
    const at = (text) => merged.indexOf(text);
    assert.ok(at("## 0.9.0 (2026-11-10)") > at("Intro."));
    assert.ok(at("## 0.9.0 (2026-11-10)") < at("## 0.8.0"));
    assert.ok(at("**Added: first.**") < at("**Fixed: second.**"));
    assert.ok(at("**Fixed: second.**") < at("**Changed: new.**"));
    assert.ok(at("**Changed: new.**") < at("## 0.8.0"));
    assert.ok(merged.includes("**Fixed: old.** Old."));
  });

  it("extends a section already written for the version instead of duplicating it", () => {
    const merged = mergeChangelog(CHANGELOG, {
      version: "0.8.0",
      date: "2026-11-10",
      entries: ["**Fixed: new.** New."],
    });
    assert.equal(merged.match(/^## 0\.8\.0/gmu).length, 1);
    const at = (text) => merged.indexOf(text);
    assert.ok(at("## 0.8.0 — Older (2026-11-02)") < at("**Added: first.**"));
    assert.ok(at("**Fixed: new.**") < at("**Fixed: old.**"));
    assert.ok(at("**Fixed: old.**") < at("## 0.7.0"));
  });

  it("works without an Unreleased section and leaves a changelog alone when there is nothing to add", () => {
    const plain = CHANGELOG.replace(/## Unreleased[\s\S]*?(?=## 0\.8\.0)/u, "");
    assert.equal(mergeChangelog(plain, { version: "0.9.0", date: "d", entries: [] }), plain);
    const merged = mergeChangelog(plain, { version: "0.9.0", date: "d", entries: ["E"] });
    assert.ok(merged.indexOf("## 0.9.0 (d)") < merged.indexOf("## 0.8.0"));
  });

  it("drops an empty Unreleased heading even when the release has nothing to render", () => {
    const empty =
      "# Changelog\n\n## Unreleased\n\n## 0.8.0 — Older (2026-11-02)\n\n**Fixed: old.** Old.\n";
    const merged = mergeChangelog(empty, { version: "0.9.0", date: "d", entries: [] });
    assert.ok(!merged.includes("## Unreleased"));
    assert.ok(merged.includes("## 0.8.0"));
    assert.ok(!merged.includes("## 0.9.0"));
  });

  it("appends the first section to a changelog that has none", () => {
    const merged = mergeChangelog("# Changelog\n", { version: "0.1.0", date: "d", entries: ["E"] });
    assert.equal(merged, "# Changelog\n\n## 0.1.0 (d)\n\nE\n");
  });
});

const check = (changed, extra = {}) =>
  checkChangeset({ changed, added: [], labels: [], isPublished: () => true, ...extra });

describe("checkChangeset", () => {
  it("passes a PR that changes no shipped source", () => {
    assert.equal(check(["docs/a.md", "scripts/x.mjs", "apps/website/a.md"]).ok, true);
    assert.equal(
      check([
        "packages/core/src/a.test.ts",
        "packages/core/src/a.integration.test.ts",
        "packages/db-sqlite/src/test-helpers/x.ts",
      ]).ok,
      true,
    );
  });

  it("fails a PR that changes a package's source or a published manifest without a changeset", () => {
    assert.equal(check(["packages/core/src/a.ts"]).ok, false);
    assert.equal(check(["packages/core/package.json"]).ok, false);
    assert.match(check(["packages/core/src/a.ts"]).reason, /without a changeset/u);
  });

  it("treats core's published test-helpers as shipped, and other packages' as not", () => {
    assert.equal(check(["packages/core/src/test-helpers/queue-contract.ts"]).ok, false);
    assert.equal(check(["packages/db-sqlite/src/test-helpers/x.ts"]).ok, true);
    assert.equal(check(["packages/core/src/test-helpers/queue-contract.test.ts"]).ok, true);
  });

  it("ignores a private manifest", () => {
    assert.equal(check(["packages/x/package.json"], { isPublished: () => false }).ok, true);
  });

  it("passes with a changeset (not the README) or the no-release label", () => {
    const src = ["packages/core/src/a.ts"];
    assert.equal(check(src, { added: [".changeset/brave-owls.md"] }).ok, true);
    assert.equal(check(src, { added: [".changeset/README.md"] }).ok, false);
    assert.equal(check(src, { labels: ["no-release"] }).ok, true);
  });
});
