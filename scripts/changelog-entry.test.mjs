import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { entryProblems, readEntry, renderGrouped, shortNotes } from "./changelog-entry.mjs";
import { releaseNotes } from "./release-notes.mjs";

describe("readEntry", () => {
  it("reads `<Kind>: <summary>` and the details below it", () => {
    assert.deepEqual(readEntry("Fixed: the thing (#1).\n\nWhy.\n\nMore."), {
      kind: "Fixed",
      summary: "the thing (#1).",
      details: "Why.\n\nMore.",
    });
  });

  it("reads an older entry by its lead and first sentence", () => {
    assert.deepEqual(readEntry("**Added: a `x.y` thing.** It does Z. Also W.\n\nMore."), {
      kind: "Added",
      summary: "a `x.y` thing.",
      details: "It does Z. Also W.\n\nMore.",
    });
    assert.equal(readEntry("Security hardening: cookies. Set.").kind, "Security");
    assert.equal(readEntry("API change: errors are JSON.").kind, "Breaking");
    assert.deepEqual(readEntry("Content collection is faster, e.g. on S3. Yes."), {
      kind: "Changed",
      summary: "Content collection is faster, e.g. on S3.",
      details: "Yes.",
    });
  });
});

describe("entryProblems", () => {
  it("passes a one-line summary of at most 100 characters", () => {
    assert.deepEqual(entryProblems("Internal: stories for the table.\n\nDetails."), []);
    assert.deepEqual(entryProblems(`Added: ${"x".repeat(100)}`), []);
  });

  it("refuses prose, a wrapped first line, an unknown kind and a long summary", () => {
    for (const body of ["Fixed a thing.", "Fixed: a\nwrapped line.", "Fix: thing."]) {
      assert.match(entryProblems(body)[0] ?? "", /start with one line "<Kind>: <summary>"/u);
    }
    assert.match(entryProblems(`Added: ${"x".repeat(101)}`)[0] ?? "", /101 characters/u);
  });
});

describe("renderGrouped and shortNotes", () => {
  const blocks = renderGrouped([
    "Fixed: B.\n\nWhy B.\n- a list\n\nMore B.",
    "Internal: stories.",
    "Breaking: errors are JSON.",
    "Internal: tests.\n\nWhich.",
    "Fixed: C.",
  ]);

  it("groups by kind in a fixed order, capitalises the summary and indents its details", () => {
    assert.deepEqual(blocks, [
      "### Breaking\n\n- Errors are JSON.",
      "### Fixed\n\n- B.\n\n  Why B.\n  - a list\n\n  More B.\n\n- C.",
      "### Internal\n\n- Stories.\n\n- Tests.\n\n  Which.",
    ]);
  });

  it("keeps the summaries, counts the internal entries, and leaves an older section alone", () => {
    assert.equal(
      shortNotes(`\nCarried prose.\n\n${blocks.join("\n\n")}\n`),
      "Carried prose.\n\n### Breaking\n\n- Errors are JSON.\n\n### Fixed\n\n- B.\n- C.\n\nPlus 2 internal changes.",
    );
    assert.equal(shortNotes("\n**Fixed: x.** Y.\n\n"), "**Fixed: x.** Y.");
  });
});

describe("releaseNotes", () => {
  const changelog =
    "# Changelog\n\n## 0.11.0 (2026-11-16)\n\n### Added\n\n- A.\n\n  Long.\n\n## 0.10.1 (2026-11-12)\n\n**Fixed: x.** Y.\n";

  it("prints the short section, a link to the full one and the diff from the previous release", () => {
    assert.equal(
      releaseNotes(changelog, "v0.11.0"),
      "### Added\n\n- A.\n\n" +
        "**Details:** https://github.com/GuptaSiddhant/StoryShelf/blob/v0.11.0/CHANGELOG.md#0110-2026-11-16\n" +
        "**Full diff:** https://github.com/GuptaSiddhant/StoryShelf/compare/v0.10.1...v0.11.0\n",
    );
  });

  it("has no diff link for the oldest section, and nothing for an unknown tag", () => {
    assert.match(
      releaseNotes(changelog, "v0.10.1") ?? "",
      /^\*\*Fixed: x\.\*\* Y\.\n\n\*\*Details:/u,
    );
    assert.doesNotMatch(releaseNotes(changelog, "v0.10.1") ?? "", /Full diff/u);
    assert.equal(releaseNotes(changelog, "v9.9.9"), null);
  });
});
