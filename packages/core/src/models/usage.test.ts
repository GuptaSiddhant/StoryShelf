import { describe, expect, it } from "vitest";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { PackageUsageModel } from "./usage.ts";

const row = {
  storyImportPath: "src/Card.stories.tsx",
  packageName: "@acme/ds",
  modulePath: "node_modules/@acme/ds/dist/Button.js",
  version: "2.4.0",
};

describe("PackageUsageModel", () => {
  it("stores usage rows for a build", async () => {
    const { db } = makeDatabase();
    const model = new PackageUsageModel(db);
    expect(await model.replaceForBuild("p1", "b1", [row, { ...row, version: undefined }])).toBe(2);
    const stored = await model.listForBuild("b1");
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({ projectId: "p1", packageName: "@acme/ds" });
    expect(new Set(stored.map((r) => r.version))).toEqual(new Set(["2.4.0", null]));
  });

  it("replaces previous rows and leaves other builds alone", async () => {
    const { db } = makeDatabase();
    const model = new PackageUsageModel(db);
    await model.replaceForBuild("p1", "b1", [row]);
    await model.replaceForBuild("p1", "b2", [row]);
    await model.replaceForBuild("p1", "b1", []);
    expect(await model.listForBuild("b1")).toEqual([]);
    expect(await model.listForBuild("b2")).toHaveLength(1);
  });

  it("lists links by downstream project", async () => {
    const { db } = makeDatabase();
    const model = new PackageUsageModel(db);
    await db.insert(db.tables.projectLinks, {
      id: "l1",
      downstreamId: "app",
      upstreamId: "ds",
      packageName: "@acme/ds",
      createdAt: "2026-01-01T00:00:00.000Z",
    } as never);
    expect(await model.listLinks("app")).toHaveLength(1);
    expect(await model.listLinks("other")).toEqual([]);
  });
});
