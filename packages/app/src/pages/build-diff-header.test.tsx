import type { Build } from "@storyshelf/core/schema";
import { describe, expect, it } from "vitest";
import { emptyCopy } from "./build-diff-empty.tsx";

const build = (status: Build["status"]): Build => ({ status }) as Build;

describe("emptyCopy", () => {
  it("never says capture may still be running for a terminal build", () => {
    const terminal = ["approved", "rejected", "failed", "cancelled", "reviewing"] as const;
    for (const status of terminal) {
      const { title, description } = emptyCopy(build(status));
      expect(`${title} ${description}`).not.toMatch(/still be running|Capturing/u);
    }
  });

  it("words each status of a build without snapshots", () => {
    expect(emptyCopy(build("pending")).title).toBe("Queued");
    expect(emptyCopy(build("capturing")).title).toBe("Capturing…");
    expect(emptyCopy(build("cancelled")).title).toBe("Capture cancelled");
    expect(emptyCopy(build("failed")).description).toContain("No reason");
    expect(emptyCopy(build("approved")).title).toBe("No stories");
  });
});
