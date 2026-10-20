import { describe, expect, it } from "vitest";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { CaptureShardModel, FINALIZE_STALE_MS } from "./capture-shard.ts";

function setup() {
  const { db } = makeDatabase();
  return { db, model: new CaptureShardModel(db) };
}

const plan = {
  attemptId: "att-1",
  payload: '{"engines":["chromium"]}',
  result: '{"storyIds":["a"]}',
};

describe("CaptureShardModel", () => {
  it("creates the plan row and numbered pending render shards", async () => {
    const { model } = setup();
    const created = await model.createPlan("p1", "b1", plan, [
      { payload: "s1" },
      { payload: "s2" },
    ]);

    expect(created.map((row) => [row.kind, row.ordinal, row.status, row.payload])).toEqual([
      ["render", 1, "pending", "s1"],
      ["render", 2, "pending", "s2"],
    ]);
    const stored = await model.plan("b1");
    expect(stored).toMatchObject({ kind: "plan", status: "done", attemptId: "att-1" });
    expect(stored?.result).toBe('{"storyIds":["a"]}');
    expect((await model.listForBuild("b1")).map((row) => row.kind)).toEqual([
      "plan",
      "render",
      "render",
    ]);
  });

  it("walks a shard through running, done and failed", async () => {
    const { model } = setup();
    const [first, second] = await model.createPlan("p1", "b1", plan, [
      { payload: "a" },
      { payload: "b" },
    ]);

    await model.markRunning(first?.id ?? "");
    expect((await model.get(first?.id ?? ""))?.status).toBe("running");
    await model.complete(first?.id ?? "", '{"failedStoryIds":[]}');
    await model.fail(second?.id ?? "", "browser crashed");

    expect(await model.get(first?.id ?? "")).toMatchObject({
      status: "done",
      result: '{"failedStoryIds":[]}',
      error: null,
    });
    expect(await model.get(second?.id ?? "")).toMatchObject({
      status: "failed",
      error: "browser crashed",
    });
  });

  it("lets a redelivered shard complete again and clear its earlier error", async () => {
    const { model } = setup();
    const [shard] = await model.createPlan("p1", "b1", plan, [{ payload: "a" }]);
    await model.fail(shard?.id ?? "", "first try failed");
    await model.complete(shard?.id ?? "", "{}");
    expect(await model.get(shard?.id ?? "")).toMatchObject({ status: "done", error: null });
  });

  it("keeps a finished shard done when a redelivered duplicate runs or fails afterwards", async () => {
    const { model } = setup();
    const [shard] = await model.createPlan("p1", "b1", plan, [{ payload: "s1" }]);
    const id = shard?.id ?? "";
    await model.markRunning(id);
    await model.complete(id, '{"captured":3}');

    await model.markRunning(id);
    await model.retry(id, "duplicate crashed");
    await model.fail(id, "duplicate crashed for good");

    expect(await model.get(id)).toMatchObject({
      status: "done",
      error: null,
      result: '{"captured":3}',
    });
  });

  it("keeps builds apart and clears one build's rows", async () => {
    const { model } = setup();
    await model.createPlan("p1", "b1", plan, [{ payload: "a" }]);
    await model.createPlan("p1", "b2", plan, [{ payload: "a" }, { payload: "b" }]);

    await model.clearBuild("b1");

    expect(await model.listForBuild("b1")).toEqual([]);
    expect(await model.renderShards("b2")).toHaveLength(2);
    expect(await model.plan("b1")).toBeNull();
  });

  it("lets exactly one caller claim the finalize", async () => {
    const { model } = setup();
    await model.createPlan("p1", "b1", plan, [{ payload: "a" }]);

    const results = await Promise.all(
      Array.from({ length: 5 }, async () => await model.claimFinalize("p1", "b1")),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await model.listForBuild("b1")).at(-1)?.kind).toBe("finalize");
  });

  it("a cleared build can be claimed again by a new plan", async () => {
    const { model } = setup();
    await model.createPlan("p1", "b1", plan, [{ payload: "a" }]);
    expect(await model.claimFinalize("p1", "b1")).toBe(true);
    expect(await model.claimFinalize("p1", "b1")).toBe(false);
    await model.clearBuild("b1");
    await model.createPlan("p1", "b1", plan, [{ payload: "a" }]);
    expect(await model.claimFinalize("p1", "b1")).toBe(true);
  });

  it("surfaces a failure that is not a lost claim", async () => {
    const { db, model } = setup();
    db.insert = async () => {
      throw new Error("connection reset");
    };
    await expect(model.claimFinalize("p1", "b1")).rejects.toThrow("connection reset");
  });

  it("a released claim can be taken again; a finished one cannot", async () => {
    const { model } = setup();
    await model.createPlan("p1", "b1", plan, [{ payload: "a" }]);
    expect(await model.claimFinalize("p1", "b1")).toBe(true);
    await model.releaseFinalize("b1");
    expect(await model.claimFinalize("p1", "b1")).toBe(true);
    await model.finishFinalize("b1");

    const later = new Date(Date.now() + FINALIZE_STALE_MS * 2);
    expect(await model.claimFinalize("p1", "b1", later)).toBe(false);
    expect((await model.listForBuild("b1")).at(-1)).toMatchObject({ status: "done" });
  });

  it("takes over a claim left running by a worker that died mid-finalize", async () => {
    const { model } = setup();
    await model.createPlan("p1", "b1", plan, [{ payload: "a" }]);
    const start = new Date("2026-01-01T00:00:00.000Z");
    expect(await model.claimFinalize("p1", "b1", start)).toBe(true);

    const soon = new Date(start.getTime() + FINALIZE_STALE_MS - 1);
    expect(await model.claimFinalize("p1", "b1", soon)).toBe(false);
    const late = new Date(start.getTime() + FINALIZE_STALE_MS);
    expect(await model.claimFinalize("p1", "b1", late)).toBe(true);
    // The takeover restarts the clock, so a third run does not barge in right behind it.
    expect(await model.claimFinalize("p1", "b1", late)).toBe(false);
  });
});
