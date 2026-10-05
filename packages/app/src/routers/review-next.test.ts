import type { Snapshot } from "@storyshelf/core/schema";
import { describe, expect, it } from "vitest";
import { nextOpenSnapshotId } from "./review-next.ts";

const snap = (id: string, status: string): Snapshot => ({ id, status }) as unknown as Snapshot;

describe("nextOpenSnapshotId", () => {
  const list = [
    snap("a", "changed"),
    snap("b", "unchanged"),
    snap("c", "new"),
    snap("d", "approved"),
  ];

  it("skips decided and unchanged snapshots after the current one", () => {
    expect(nextOpenSnapshotId(list, "a")).toBe("c");
  });

  it("wraps around to open snapshots before the current one", () => {
    expect(nextOpenSnapshotId(list, "c")).toBe("a");
    expect(nextOpenSnapshotId(list, "d")).toBe("a");
  });

  it("returns null when the current snapshot is the only open one", () => {
    expect(nextOpenSnapshotId([snap("a", "changed"), snap("b", "approved")], "a")).toBeNull();
    expect(nextOpenSnapshotId([], "a")).toBeNull();
  });

  it("starts from the top when the current id is unknown", () => {
    expect(nextOpenSnapshotId(list, "missing")).toBe("a");
  });
});
