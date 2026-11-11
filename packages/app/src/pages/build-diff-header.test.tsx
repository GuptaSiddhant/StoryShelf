import type { Build, Snapshot } from "@storyshelf/core/schema";
import { describe, expect, it } from "vitest";
import type { BuildDetailsData } from "./build-detail.tsx";
import { summaryLine } from "./build-diff-header.tsx";

const build = { inheritedCount: 4 } as Build;
const snapshot = (status: string, a11y: string | null = null): Snapshot =>
  ({
    id: status,
    storyId: status,
    modeKey: "",
    status,
    a11yViolations: a11y,
  }) as unknown as Snapshot;
const details = (patch: Partial<BuildDetailsData>): BuildDetailsData => ({
  testing: true,
  published: false,
  labels: [],
  components: 2,
  stories: 3,
  attempts: [],
  review: null,
  ...patch,
});

describe("summaryLine", () => {
  it("counts what is left to review, the snapshots, the inherited ones and the findings", () => {
    const snapshots = [snapshot("changed"), snapshot("unchanged")];
    expect(summaryLine(build, snapshots, details({}))).toBe(
      "1 to review · 2 snapshots · 4 inherited · 0 a11y findings",
    );
  });

  it("uses the singular for one snapshot", () => {
    expect(summaryLine(build, [snapshot("unchanged")], details({ testing: true }))).toContain(
      "1 snapshot ·",
    );
  });

  it("falls back to the catalog counts without capture", () => {
    expect(summaryLine(build, [], details({ testing: false }))).toBe("2 components · 3 stories");
    expect(
      summaryLine(build, [], details({ testing: false, components: null, stories: null })),
    ).toBe("");
  });
});
