import { describe, expect, it } from "vitest";
import { badgesOf } from "./badge.ts";
import { SNAPSHOT_STATUSES } from "./types.ts";

describe("badgesOf", () => {
  it("gives every status a label", () => {
    for (const status of SNAPSHOT_STATUSES) {
      expect(badgesOf({ status })[0]?.label).toBeTruthy();
    }
  });

  it("says pending review for a pending story", () => {
    expect(badgesOf({ status: "pending" })).toEqual([{ label: "Pending review", tone: "warn" }]);
  });

  it("adds a design badge only for a known problem", () => {
    expect(badgesOf({ status: "unchanged" })).toHaveLength(1);
    expect(badgesOf({ status: "unchanged", design: "stale" }).map((badge) => badge.label)).toEqual([
      "Unchanged",
      "Design stale",
    ]);
    expect(badgesOf({ status: "changed", design: "deleted" }).at(-1)?.tone).toBe("bad");
  });
});
