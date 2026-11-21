import { describe, expect, it } from "vitest";
import {
  MAX_COMMENT_CHARS,
  buildCommentMarkdown,
  skippedCommentMarkdown,
  type BuildCommentInput,
  type CommentChange,
} from "./build-comment.ts";

const counts = { snapshotCount: 120, changedCount: 3, approvedCount: 0, rejectedCount: 0 };

function change(n: number, extra: Partial<CommentChange> = {}): CommentChange {
  return {
    story: `Button / Story ${String(n)}`,
    target: "chromium, desktop",
    change: "2.4 %",
    reviewUrl: `https://s/r/${String(n)}`,
    storyUrl: `https://s/sb/b1/index.html?path=/story/button--s${String(n)}`,
    ...extra,
  };
}

function input(extra: Partial<BuildCommentInput> = {}): BuildCommentInput {
  return {
    testing: true,
    status: "reviewing",
    sha: "454d6e4",
    reviewUrl: "https://s/diff",
    buildUrl: "https://s/build",
    storybookUrl: "https://s/sb/b1/index.html",
    counts,
    changes: [change(1), change(2, { change: "new", storyUrl: undefined }), change(3)],
    updatedAt: "2026-11-20T16:42:10Z",
    ...extra,
  };
}

describe("buildCommentMarkdown: testing on", () => {
  it("waits for review with the changed stories", () => {
    expect(buildCommentMarkdown(input({ a11yCount: 2 }))).toMatchInlineSnapshot(`
      "### 🟡 StoryShelf: 3 visual changes need review

      [**Review changes →**](https://s/diff) · [Approve on StoryShelf](https://s/diff) · [Storybook](https://s/sb/b1/index.html) · [Build](https://s/build)

      | Story | Target | Change | |
      |---|---|---|---|
      | Button / Story 1 | chromium, desktop | 2.4 % | [review](https://s/r/1) · [story](https://s/sb/b1/index.html?path=/story/button--s1) |
      | Button / Story 2 | chromium, desktop | new | [review](https://s/r/2) |
      | Button / Story 3 | chromium, desktop | 2.4 % | [review](https://s/r/3) · [story](https://s/sb/b1/index.html?path=/story/button--s3) |

      117 unchanged · 2 a11y findings

      <sub>Commit \`454d6e4\` · updated 16:42 UTC</sub>"
    `);
  });

  it("is capturing before the comparison", () => {
    expect(buildCommentMarkdown(input({ status: "capturing", changes: [] })))
      .toMatchInlineSnapshot(`
      "### ⏳ StoryShelf: Capturing

      [**Review changes →**](https://s/diff) · [Storybook](https://s/sb/b1/index.html) · [Build](https://s/build)

      <sub>Commit \`454d6e4\` · updated 16:42 UTC</sub>"
    `);
  });

  it("shrinks an approved build to one line, naming the approver without pinging them", () => {
    expect(
      buildCommentMarkdown(input({ status: "approved", reviewer: "ada" })),
    ).toMatchInlineSnapshot(
      `"### ✅ StoryShelf: Approved by \`ada\` · [**Review changes →**](https://s/diff) · [Storybook](https://s/sb/b1/index.html) · [Build](https://s/build)"`,
    );
  });

  it("names who rejected", () => {
    expect(buildCommentMarkdown(input({ status: "rejected", reviewer: "ada" })))
      .toMatchInlineSnapshot(`
      "### ❌ StoryShelf: Rejected by \`ada\`

      [**Review changes →**](https://s/diff) · [Storybook](https://s/sb/b1/index.html) · [Build](https://s/build)

      | Story | Target | Change | |
      |---|---|---|---|
      | Button / Story 1 | chromium, desktop | 2.4 % | [review](https://s/r/1) · [story](https://s/sb/b1/index.html?path=/story/button--s1) |
      | Button / Story 2 | chromium, desktop | new | [review](https://s/r/2) |
      | Button / Story 3 | chromium, desktop | 2.4 % | [review](https://s/r/3) · [story](https://s/sb/b1/index.html?path=/story/button--s3) |

      117 unchanged

      <sub>Commit \`454d6e4\` · updated 16:42 UTC</sub>"
    `);
  });

  it("links the log and the retry of a failed capture", () => {
    expect(
      buildCommentMarkdown(
        input({
          status: "failed",
          failure: "browser crashed",
          logUrl: "https://s/build#log",
          retryUrl: "https://s/build#retry",
          changes: [],
        }),
      ),
    ).toMatchInlineSnapshot(`
      "### ⚠️ StoryShelf: Capture failed (browser crashed)

      [Build log](https://s/build#log) · [Retry capture](https://s/build#retry) · [Storybook](https://s/sb/b1/index.html) · [Build](https://s/build)

      <sub>Commit \`454d6e4\` · updated 16:42 UTC</sub>"
    `);
  });

  it("never lets a commit id escape its code span or mention anyone", () => {
    const hostile = "`]@bob";
    const markdown = [
      buildCommentMarkdown(
        input({ status: "cancelled", supersededBy: { sha: hostile, url: "https://s/b2" } }),
      ),
      buildCommentMarkdown(input({ sha: hostile })),
      buildCommentMarkdown(
        input({ earlier: [{ state: "✅ approved", sha: hostile, url: "https://s/b0" }] }),
      ),
      skippedCommentMarkdown({ buildUrl: "u", source: { sha: hostile, url: "s" } }),
    ].join("\n");
    expect(markdown).not.toContain("@bob");
    expect(markdown).toContain("`bob`");
  });

  it("says a cancelled build was superseded", () => {
    expect(
      buildCommentMarkdown(
        input({ status: "cancelled", supersededBy: { sha: "abc1234", url: "https://s/b2" } }),
      ),
    ).toMatchInlineSnapshot(`
      "### ⚪ StoryShelf: Cancelled: superseded by [\`abc1234\`](https://s/b2)

      [**Review changes →**](https://s/diff) · [Storybook](https://s/sb/b1/index.html) · [Build](https://s/build)

      | Story | Target | Change | |
      |---|---|---|---|
      | Button / Story 1 | chromium, desktop | 2.4 % | [review](https://s/r/1) · [story](https://s/sb/b1/index.html?path=/story/button--s1) |
      | Button / Story 2 | chromium, desktop | new | [review](https://s/r/2) |
      | Button / Story 3 | chromium, desktop | 2.4 % | [review](https://s/r/3) · [story](https://s/sb/b1/index.html?path=/story/button--s3) |

      <sub>Commit \`454d6e4\` · updated 16:42 UTC</sub>"
    `);
  });

  it("shows failing tests first, removed stories and the partial capture", () => {
    expect(
      buildCommentMarkdown(
        input({
          failedTests: ["Form / Submit"],
          removed: ["Old / Card"],
          capture: { rendered: 12, total: 120 },
          earlier: [{ state: "✅ approved", sha: "1111111", url: "https://s/b0" }],
        }),
      ),
    ).toMatchInlineSnapshot(`
      "### 🟡 StoryShelf: 3 visual changes need review

      [**Review changes →**](https://s/diff) · [Approve on StoryShelf](https://s/diff) · [Storybook](https://s/sb/b1/index.html) · [Build](https://s/build)

      **❌ 1 failing Storybook test** (blocks the merge)
      - Form / Submit

      | Story | Target | Change | |
      |---|---|---|---|
      | Button / Story 1 | chromium, desktop | 2.4 % | [review](https://s/r/1) · [story](https://s/sb/b1/index.html?path=/story/button--s1) |
      | Button / Story 2 | chromium, desktop | new | [review](https://s/r/2) |
      | Button / Story 3 | chromium, desktop | 2.4 % | [review](https://s/r/3) · [story](https://s/sb/b1/index.html?path=/story/button--s3) |

      **1 removed story**
      - Old / Card

      <details><summary>117 unchanged · 1 earlier build</summary>

      - ✅ approved · [\`1111111\`](https://s/b0)

      </details>

      <sub>Commit \`454d6e4\` · partial capture (12 of 120 stories) · updated 16:42 UTC</sub>"
    `);
  });
});

describe("buildCommentMarkdown: hosting only", () => {
  const hosting = { testing: false, reviewUrl: "https://s/build", changes: undefined };

  it("waits for review, with the approvals while several are needed", () => {
    expect(
      buildCommentMarkdown(
        input({ ...hosting, status: "pending", approvals: { given: 1, required: 2 } }),
      ),
    ).toMatchInlineSnapshot(`
      "### 🟡 StoryShelf: Waiting for review

      [**Review changes →**](https://s/build) · [Approve on StoryShelf](https://s/build) · [Storybook](https://s/sb/b1/index.html)

      1 of 2 approvals

      <sub>Commit \`454d6e4\` · updated 16:42 UTC</sub>"
    `);
  });

  it("is approved in one line", () => {
    expect(buildCommentMarkdown(input({ ...hosting, status: "approved" }))).toMatchInlineSnapshot(
      `"### ✅ StoryShelf: Approved · [**Review changes →**](https://s/build) · [Storybook](https://s/sb/b1/index.html)"`,
    );
  });

  it("is rejected", () => {
    expect(buildCommentMarkdown(input({ ...hosting, status: "rejected" }))).toMatchInlineSnapshot(`
      "### ❌ StoryShelf: Rejected

      [**Review changes →**](https://s/build) · [Storybook](https://s/sb/b1/index.html)

      <sub>Commit \`454d6e4\` · updated 16:42 UTC</sub>"
    `);
  });
});

const headline = (reviewer: string): string =>
  buildCommentMarkdown(input({ status: "approved", reviewer })).split("\n")[0] ?? "";

describe("buildCommentMarkdown: the reviewer's name", () => {
  it("collapses every whitespace run, newlines included, so the code span cannot end early", () => {
    const line = headline("Ada\n\nLovelace \t `x`");
    expect(line).toContain("Approved by `Ada Lovelace x`");
    expect(line).not.toContain("\n");
  });

  it("is a display name, not a handle: no @ prefix, and no byline for an empty name", () => {
    expect(headline("Ada L")).toContain("Approved by `Ada L`");
    expect(headline("Ada L")).not.toContain("`@");
    expect(headline(" \n ")).toMatch(/Approved ·/u);
  });
});

describe("buildCommentMarkdown: limits and safety", () => {
  it("puts changes past the tenth into a details block", () => {
    const many = Array.from({ length: 12 }, (_, n) => change(n + 1));
    const markdown = buildCommentMarkdown(input({ changes: many }));
    expect(markdown).toContain("<details><summary>2 more changed stories</summary>");
    expect(markdown.match(/\| Button/gu)).toHaveLength(12);
  });

  it("stays under the cap, cutting the lists before the headline", () => {
    const many = Array.from({ length: 2000 }, (_, n) =>
      change(n, { story: `Story ${"x".repeat(60)} ${String(n)}` }),
    );
    const markdown = buildCommentMarkdown(input({ changes: many }));
    expect(markdown.length).toBeLessThanOrEqual(MAX_COMMENT_CHARS);
    expect(markdown).toContain("### 🟡 StoryShelf: 3 visual changes need review");
    expect(markdown).toContain("more: open the review page");
  });

  it("escapes story names so a title cannot break the table or inject HTML", () => {
    const markdown = buildCommentMarkdown(
      input({ changes: [change(1, { story: "A | <b>x</b>\n[y](z) `c`" })] }),
    );
    expect(markdown).toContain("A \\| \\<b\\>x\\</b\\> \\[y\\](z) \\`c\\`");
  });

  it("posts no live mention for a story, test or removed story named like a user", () => {
    const markdown = buildCommentMarkdown(
      input({
        changes: [change(1, { story: "@acme/button / Primary", target: "@acme" })],
        failedTests: ["@acme/form"],
        removed: ["@acme/old"],
        failure: "@acme",
        status: "reviewing",
      }),
    );
    expect(markdown).toContain("@\u200Dacme/button");
    expect(markdown).not.toMatch(/@(?!\u200D)acme/u);
  });

  it("is one line for a skipped build, with or without its source", () => {
    expect(skippedCommentMarkdown({ buildUrl: "u", source: { sha: "abc1234", url: "s" } })).toBe(
      "### ⏭️ StoryShelf: Skipped: no story changed since [`abc1234`](s) · [Build](u)",
    );
    expect(skippedCommentMarkdown({ buildUrl: "u" })).toContain("no longer exists");
  });
});
