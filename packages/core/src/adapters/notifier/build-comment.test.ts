import { describe, expect, it } from "vitest";
import { buildCommentMarkdown } from "./build-comment.ts";

describe("buildCommentMarkdown", () => {
  it("lists each gate, the counts and the Storybook link under the build link", () => {
    const markdown = buildCommentMarkdown({
      buildUrl: "https://s/b/1",
      storybookUrl: "https://s/sb/1/",
      gates: [
        { name: "review", context: "s/review", state: "pending", description: "Waiting", url: "u" },
      ],
      counts: { snapshotCount: 3, changedCount: 2, approvedCount: 1, rejectedCount: 0 },
    });
    expect(markdown.split("\n")).toEqual([
      "**StoryShelf** — [View build](https://s/b/1)",
      "- Review: Waiting",
      "- Snapshots: 3 total, 2 changed, 1 approved, 0 rejected",
      "- Storybook: [Open the published Storybook](https://s/sb/1/)",
    ]);
  });

  it("is just the build link when there is nothing else to say", () => {
    expect(
      buildCommentMarkdown({
        buildUrl: "u",
        gates: [],
        counts: { snapshotCount: 0, changedCount: 0, approvedCount: 0, rejectedCount: 0 },
      }),
    ).toBe("**StoryShelf** — [View build](u)");
  });
});
