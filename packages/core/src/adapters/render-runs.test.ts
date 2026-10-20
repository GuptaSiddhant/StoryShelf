import { describe, expect, it } from "vitest";
import { RenderRuns } from "./render-runs.ts";

describe("RenderRuns", () => {
  it("cancels one run of a build by its run id, or every run of the build without one", () => {
    const runs = new RenderRuns<string>();
    runs.add("b1", "shard-a", "A");
    runs.add("b1", "shard-b", "B");
    runs.add("b2", undefined, "other");

    expect(runs.matching("b1", "shard-a")).toEqual(["A"]);
    expect(new Set(runs.matching("b1"))).toEqual(new Set(["A", "B"]));
    expect(runs.matching("b2", "b2")).toEqual(["other"]);
    expect(runs.matching("missing")).toEqual([]);
  });

  it("removes only its own entry when a render ends, even beside a run of the same id", () => {
    const runs = new RenderRuns<string>();
    const first = runs.add("b1", "shard-a", "first");
    const second = runs.add("b1", "shard-a", "second");
    runs.add("b1", "shard-b", "sibling");

    first();
    expect(runs.matching("b1", "shard-a")).toEqual(["second"]);
    second();
    expect(runs.matching("b1")).toEqual(["sibling"]);
  });

  it("forgets a build once its last run ends, and a late remove is harmless", () => {
    const runs = new RenderRuns<string>();
    const remove = runs.add("b1", undefined, "only");
    remove();
    const again = runs.add("b1", undefined, "next");
    remove();
    expect(runs.matching("b1")).toEqual(["next"]);
    again();
    expect(runs.matching("b1")).toEqual([]);
  });
});
