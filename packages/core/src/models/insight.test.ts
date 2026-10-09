import { describe, expect, it } from "vitest";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { InsightModel, type InsightStartInput } from "./insight.ts";

const base: InsightStartInput = {
  projectId: "p1",
  buildId: "b1",
  kind: "triage",
  windowKey: null,
  inputHash: "h1",
  profile: "default",
  model: "m",
  promptVersion: "v1",
};

describe("InsightModel", () => {
  it("dedupes in-flight and finished runs with the same hash", async () => {
    const { db } = makeDatabase();
    const model = new InsightModel(db);
    const first = await model.start(base);
    expect(first.run).toBe(true);
    expect((await model.start(base)).run).toBe(false);
    await model.markRunning(first.row.id);
    await model.markDone(first.row.id, { verdict: "needs-review", summary: "s", result: "{}" });
    const hit = await model.start(base);
    expect(hit.run).toBe(false);
    expect(hit.row.status).toBe("done");
    expect((await model.start({ ...base, force: true })).run).toBe(true);
  });

  it("restarts failed rows and new hashes become new rows", async () => {
    const { db } = makeDatabase();
    const model = new InsightModel(db);
    const first = await model.start(base);
    await model.markFailed(first.row.id, "timeout");
    const again = await model.start(base);
    expect(again.run).toBe(true);
    expect(again.row.id).toBe(first.row.id);
    expect(again.row.status).toBe("pending");
    const other = await model.start({ ...base, inputHash: "h2" });
    expect(other.row.id).not.toBe(first.row.id);
    expect(await model.listForBuild("b1")).toHaveLength(2);
  });

  it("replaces a health row in place per window", async () => {
    const { db } = makeDatabase();
    const model = new InsightModel(db);
    const h = { ...base, buildId: null, kind: "health" as const, windowKey: "30d" };
    const first = await model.start(h);
    await model.markDone(first.row.id, { verdict: "healthy", summary: "s", result: "{}" });
    const next = await model.start({ ...h, inputHash: "h9" });
    expect(next.run).toBe(true);
    expect(next.row.id).toBe(first.row.id);
    expect((await model.getHealth("p1", "30d"))?.inputHash).toBe("h9");
    expect(await model.getHealth("p1", "7d")).toBeNull();
  });

  it("removes build rows, purges old health rows and sweeps stale runs", async () => {
    const { db } = makeDatabase();
    const model = new InsightModel(db);
    await model.start(base);
    await model.start({ ...base, buildId: null, kind: "health", windowKey: "30d" });
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(await model.sweepStale(future)).toBe(2);
    expect((await model.getHealth("p1", "30d"))?.errorCode).toBe("interrupted");
    expect(await model.removeForBuild("b1")).toBe(1);
    expect(await model.purgeHealthBefore(future)).toBe(1);
    expect(await model.getHealth("p1", "30d")).toBeNull();
  });
});
