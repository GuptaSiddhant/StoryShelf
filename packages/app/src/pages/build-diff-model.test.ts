import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import { describe, expect, it } from "vitest";
import {
  diffPercent,
  neighbours,
  reviewProgress,
  snapshotImageUrl,
  snapshotPageUrl,
} from "./build-diff-model.ts";

const snap = (id: string, status: string, diffRatio: number | null = null): Snapshot =>
  ({ id, status, diffRatio }) as unknown as Snapshot;
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

  it("handles an empty build", () => {
    expect(reviewProgress([])).toEqual({ reviewable: 0, done: 0, pending: 0 });
  });
});

describe("neighbours", () => {
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
