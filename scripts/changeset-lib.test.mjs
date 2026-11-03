import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PLACEHOLDER_BODY,
  bumpVersion,
  changesetName,
  checkChangeset,
  highestBump,
  malformedChangesets,
  manifestPublished,
  mergeChangelog,
  parseChangeset,
  releaseBranchVersion,
  releaseProblems,
  renderChangeset,
  renderEntries,
  unknownReleases,
} from "./changeset-lib.mjs";

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

describe("manifestPublished", () => {
  const published = '{"name":"@storyshelf/x"}';
  const priv = '{"name":"@storyshelf/x","private":true}';

  it("counts a package published on either side of the change", () => {
    assert.equal(manifestPublished(published, published), true);
    assert.equal(manifestPublished(priv, published), true, "made private: it stops shipping");
    assert.equal(manifestPublished(null, published), true, "deleted: it stops shipping");
    assert.equal(manifestPublished(published, null), true, "new: it starts shipping");
  });

  it("ignores a package that was private throughout, or unreadable", () => {
    assert.equal(manifestPublished(priv, priv), false);
    assert.equal(manifestPublished(null, null), false);
    assert.equal(manifestPublished("{not json", null), false);
  });
});

describe("malformedChangesets", () => {
  const files = {
    ".changeset/good.md": '---\n"@storyshelf/core": patch\n---\n\n**Fixed: x.** Y.\n',
    ".changeset/bad.md": "no front matter here\n",
    ".changeset/odd.md": '---\n"@storyshelf/core": huge\n---\n\nBody.\n',
  };
  const read = (path) => files[path];

  it("reports each added changeset the parser rejects", () => {
    const problems = malformedChangesets(
      [".changeset/good.md", ".changeset/bad.md", ".changeset/odd.md"],
      read,
    );
    assert.equal(problems.length, 2);
    assert.match(problems[0], /bad\.md: a changeset starts with a --- front matter block/u);
    assert.match(problems[1], /odd\.md: cannot read/u);
  });

  it("looks only at changeset files, not the README or other paths", () => {
    assert.deepEqual(malformedChangesets([".changeset/README.md", "docs/x.md"], read), []);
    assert.deepEqual(malformedChangesets([".changeset/good.md"], read), []);
  });
});

const changesetOf = (file, ...releases) => ({
  file,
  releases: releases.map(([name, bump]) => ({ name, bump })),
  body: "",
});

describe("highestBump and bumpVersion", () => {
  it("takes the largest bump of any changeset", () => {
    const patch = changesetOf("a.md", ["@storyshelf/app", "patch"]);
    const minor = changesetOf("b.md", ["@storyshelf/core", "minor"], ["@storyshelf/app", "patch"]);
    const major = changesetOf("c.md", ["@storyshelf/cli", "major"]);
    assert.equal(highestBump([patch]), "patch");
    assert.equal(highestBump([patch, minor]), "minor");
    assert.equal(highestBump([minor, major, patch]), "major");
  });

  it("applies a bump like semver, zeroing what is below it", () => {
    assert.equal(bumpVersion("0.8.0", "minor"), "0.9.0");
    assert.equal(bumpVersion("0.8.3", "minor"), "0.9.0");
    assert.equal(bumpVersion("0.8.3", "patch"), "0.8.4");
    assert.equal(bumpVersion("0.8.3", "major"), "1.0.0");
    assert.equal(bumpVersion("1.9.12", "minor"), "1.10.0");
  });

  it("refuses a version or a bump it cannot apply", () => {
    assert.throws(() => bumpVersion("0.9.0-next-abc1234", "patch"), /major\.minor\.patch/u);
    assert.throws(() => bumpVersion("0.8", "patch"), /major\.minor\.patch/u);
    assert.throws(() => bumpVersion("0.8.0", "huge"), /huge/u);
  });
});

describe("unknownReleases", () => {
  const known = ["@storyshelf/core", "storyshelf"];

  it("is empty when every released package is published here", () => {
    assert.deepEqual(
      unknownReleases([changesetOf("a.md", ["@storyshelf/core", "minor"])], known),
      [],
    );
  });

  it("names each unknown package with its file and the known ones", () => {
    const problems = unknownReleases(
      [changesetOf("a.md", ["@storyshelf/nope", "patch"], ["storyshelf", "patch"])],
      known,
    );
    assert.equal(problems.length, 1);
    assert.match(
      problems[0],
      /a\.md: unknown package "@storyshelf\/nope" \(known: @storyshelf\/core, storyshelf\)/u,
    );
  });
});

describe("renderChangeset", () => {
  it("writes front matter that parses back, and the message as the body", () => {
    const text = renderChangeset({
      packages: ["@storyshelf/core", "storyshelf"],
      bump: "minor",
      message: "  **Added: a thing (#1)**  ",
    });
    assert.equal(
      text,
      '---\n"@storyshelf/core": minor\n"storyshelf": minor\n---\n\n**Added: a thing (#1)**\n',
    );
    const parsed = parseChangeset(text, "x.md");
    assert.deepEqual(parsed.releases, [
      { name: "@storyshelf/core", bump: "minor" },
      { name: "storyshelf", bump: "minor" },
    ]);
    assert.equal(parsed.body, "**Added: a thing (#1)**");
  });

  it("uses the placeholder without a message, and CI refuses a file that keeps it", () => {
    const text = renderChangeset({ packages: ["storyshelf"], bump: "patch" });
    assert.match(text, new RegExp(PLACEHOLDER_BODY.slice(0, 20), "u"));
    const problems = malformedChangesets([".changeset/new.md"], () => text);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /replace the placeholder/u);
    assert.deepEqual(
      malformedChangesets([".changeset/new.md"], () =>
        text.replace(PLACEHOLDER_BODY, "**Fixed: x (#1)**"),
      ),
      [],
    );
  });

  it("refuses an unknown bump or no package", () => {
    assert.throws(() => renderChangeset({ packages: ["storyshelf"], bump: "huge" }), /huge/u);
    assert.throws(() => renderChangeset({ packages: [], bump: "patch" }), /at least one package/u);
  });
});

/** The first name the word lists produce when `random` always picks index 0. */
const isFirstName = (name) => name === "brave-apples-dance";

describe("changesetName", () => {
  it("builds three words and skips a name that is taken", () => {
    const picks = [0, 0, 0, 1, 1, 1];
    const random = () => picks.shift();
    assert.equal(changesetName(random, isFirstName), "calm-bears-glow");
  });

  it("gives up when every name is taken", () => {
    assert.throws(
      () =>
        changesetName(
          () => 0,
          () => true,
        ),
      /free changeset name/u,
    );
  });
});

describe("releaseBranchVersion", () => {
  it("reads the version of release/v<version> and nothing else", () => {
    assert.equal(releaseBranchVersion("release/v0.9.0"), "0.9.0");
    assert.equal(releaseBranchVersion("release/v10.2.31"), "10.2.31");
    for (const other of [
      "release/0.9.0",
      "release/v0.9",
      "release/v0.9.0-next",
      "feature/release/v0.9.0",
      "main",
      "",
      undefined,
    ]) {
      assert.equal(releaseBranchVersion(other), null);
    }
  });
});

const releaseManifest = (version, extra = {}) =>
  JSON.stringify({ name: "@storyshelf/core", version, ...extra }, null, 2);

/** `releaseProblems` for release 0.9.0 whose manifests went from 0.8.0 to 0.9.0 unless `files` says otherwise. */
const runRelease = (entries, files = {}) =>
  releaseProblems({
    version: "0.9.0",
    entries,
    readBase: (path) => files[`base:${path}`] ?? releaseManifest("0.8.0"),
    readHead: (path) => files[`head:${path}`] ?? releaseManifest("0.9.0"),
  });

describe("releaseProblems, a valid release", () => {
  it("passes new versions, the changelog and consumed changesets", () => {
    assert.deepEqual(
      runRelease([
        { status: "M", path: "packages/core/package.json" },
        { status: "M", path: "packages/app/package.json" },
        { status: "M", path: "CHANGELOG.md" },
        { status: "D", path: ".changeset/brave-apples-dance.md" },
        { status: "D", path: ".changeset/calm-bears-glow.md" },
      ]),
      [],
    );
  });

  it("leaves the changelog alone and still counts the changesets README as foreign", () => {
    assert.deepEqual(runRelease([{ status: "M", path: "CHANGELOG.md" }]), []);
    assert.deepEqual(runRelease([{ status: "M", path: ".changeset/README.md" }]), [
      ".changeset/README.md is not part of a release",
    ]);
  });
});

describe("releaseProblems, a branch that is not only a release", () => {
  it("fails anything else a release branch changes", () => {
    const problems = runRelease([
      { status: "M", path: "packages/core/package.json" },
      { status: "M", path: "packages/core/src/index.ts" },
      { status: "A", path: "docs/notes.md" },
    ]);
    assert.deepEqual(problems, [
      "packages/core/src/index.ts is not part of a release",
      "docs/notes.md is not part of a release",
    ]);
  });

  it("fails a changeset that is added or edited, not deleted", () => {
    assert.deepEqual(runRelease([{ status: "A", path: ".changeset/new-one.md" }]), [
      ".changeset/new-one.md must be deleted by a release, not changed",
    ]);
  });

  it("fails a manifest that changes more than its version, or to another version", () => {
    const entry = [{ status: "M", path: "packages/core/package.json" }];
    const wider = releaseManifest("0.9.0", { dependencies: { left: "1.0.0" } });
    assert.deepEqual(runRelease(entry, { "head:packages/core/package.json": wider }), [
      "packages/core/package.json changes more than its version",
    ]);
    assert.deepEqual(
      runRelease(entry, { "head:packages/core/package.json": releaseManifest("0.9.1") }),
      ["packages/core/package.json is at 0.9.1, not 0.9.0"],
    );
  });

  it("fails a manifest it cannot read", () => {
    assert.deepEqual(
      runRelease([{ status: "M", path: "packages/core/package.json" }], {
        "head:packages/core/package.json": "{",
      }),
      ["packages/core/package.json cannot be read on both sides"],
    );
  });
});
