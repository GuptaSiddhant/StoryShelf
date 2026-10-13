import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import { describe, expect, it } from "vitest";
import {
  diffPercent,
  groupOf,
  groupSnapshots,
  isOpenGroup,
  neighbours,
  reviewProgress,
  snapshotImageUrl,
  snapshotPageUrl,
} from "./build-diff-model.ts";

const snap = (
  id: string,
  status: string,
  diffRatio: number | null = null,
  extra: Partial<Pick<Snapshot, "storyId" | "viewportName" | "browser">> = {},
): Snapshot =>
  ({
    id,
    status,
    diffRatio,
    storyId: `story-${id}`,
    viewportName: "desktop",
    browser: "chromium",
    ...extra,
  }) as unknown as Snapshot;
const project = { slug: "demo" } as Project;
const build = { id: "b1" } as Build;

describe("reviewProgress", () => {
  it("excludes unchanged snapshots and counts decided ones as done", () => {
    const progress = reviewProgress([
      snap("1", "changed"),
      snap("2", "new"),
      snap("3", "approved"),
      snap("4", "rejected"),
      snap("5", "unchanged"),
    ]);
    expect(progress).toEqual({ reviewable: 4, done: 2, pending: 2 });
  });

  it("counts a story/mode once across browsers (shared approval)", () => {
    const shared = { storyId: "s", viewportName: "dark" };
    expect(
      reviewProgress([
        snap("c", "changed", null, shared),
        snap("f", "changed", null, { ...shared, browser: "firefox" }),
        snap("x", "approved", null, { storyId: "x" }),
      ]),
    ).toEqual({ reviewable: 2, done: 1, pending: 1 });
    // one engine decided individually, the other still open: the group stays pending
    expect(
      reviewProgress([
        snap("c", "approved", null, shared),
        snap("f", "changed", null, { ...shared, browser: "firefox" }),
      ]),
    ).toEqual({ reviewable: 1, done: 0, pending: 1 });
  });

  it("handles an empty build", () => {
    expect(reviewProgress([])).toEqual({ reviewable: 0, done: 0, pending: 0 });
  });
});

describe("groupSnapshots", () => {
  it("groups engines of one story/mode, chromium first, representative = first open", () => {
    const shared = { storyId: "s", viewportName: "dark" };
    const groups = groupSnapshots([
      snap("w", "approved", null, { ...shared, browser: "webkit" }),
      snap("f", "changed", null, { ...shared, browser: "firefox" }),
      snap("c", "approved", null, shared),
      snap("other", "new", null, { storyId: "o" }),
    ]);
    expect(groups.map((g) => g.members.map((m) => m.id))).toEqual([["c", "f", "w"], ["other"]]);
    expect(groups[0]?.representative.id).toBe("f");
    expect(groups[0]).toMatchObject({ storyId: "s", modeKey: "dark" });
    expect(groups[1] && isOpenGroup(groups[1])).toBe(true);
  });

  it("separates modes of the same story", () => {
    const groups = groupSnapshots([
      snap("a", "new", null, { storyId: "s", viewportName: "dark" }),
      snap("b", "new", null, { storyId: "s", viewportName: "light" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("finds the group of a snapshot", () => {
    const shared = { storyId: "s", viewportName: "dark" };
    const list = [
      snap("c", "new", null, shared),
      snap("f", "new", null, { ...shared, browser: "firefox" }),
    ];
    expect(groupOf(list, "f")?.members).toHaveLength(2);
    expect(groupOf(list, "nope")).toBeUndefined();
  });
});

describe("neighbours", () => {
  it("steps between groups, not browsers", () => {
    const shared = { storyId: "s", viewportName: "dark" };
    const list = [
      snap("c", "new", null, shared),
      snap("f", "new", null, { ...shared, browser: "firefox" }),
      snap("z", "new"),
    ];
    const result = neighbours(list, "f");
    expect(result).toMatchObject({ position: 1, total: 2, prev: null });
    expect(result.next?.id).toBe("z");
  });

  const list = [snap("a", "new"), snap("b", "new"), snap("c", "new")];

  it("returns position and both neighbours for a middle item", () => {
    const result = neighbours(list, "b");
    expect(result.position).toBe(2);
    expect(result.total).toBe(3);
    expect(result.prev?.id).toBe("a");
    expect(result.next?.id).toBe("c");
  });

  it("has no prev at the start and no next at the end", () => {
    expect(neighbours(list, "a").prev).toBeNull();
    expect(neighbours(list, "c").next).toBeNull();
  });

  it("reports position 0 when the selection is missing", () => {
    expect(neighbours(list, "zzz")).toEqual({ position: 0, total: 3, prev: null, next: null });
    expect(neighbours(list).position).toBe(0);
  });
});

describe("formatting and urls", () => {
  it("formats diff ratios as percentages", () => {
    expect(diffPercent(snap("a", "changed", 0.031))).toBe("3.1%");
    expect(diffPercent(snap("a", "changed", 0))).toBe("0.0%");
    expect(diffPercent(snap("a", "changed", null))).toBeNull();
  });

  it("builds page and image urls", () => {
    expect(snapshotPageUrl(project, build, "s1")).toBe("/projects/demo/builds/b1/diff?snapshot=s1");
    expect(snapshotImageUrl(project, build, snap("s1", "new"), "diff")).toBe(
      "/api/v1/projects/demo/builds/b1/snapshots/s1/diff",
    );
  });
});
