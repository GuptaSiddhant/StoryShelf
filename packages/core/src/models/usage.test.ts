import { describe, expect, it } from "vitest";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { matchUpstreamStory, PackageUsageModel } from "./usage.ts";

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

describe("PackageUsageModel links and story filter", () => {
  it("replaces a project's links", async () => {
    const { db } = makeDatabase();
    const model = new PackageUsageModel(db);
    await model.replaceLinks("app", [{ upstreamId: "ds", packageName: "@acme/ds" }]);
    const next = await model.replaceLinks("app", [
      { upstreamId: "ds2", packageName: "@acme/icons" },
    ]);
    expect(next).toHaveLength(1);
    expect(await model.listLinks("app")).toMatchObject([{ packageName: "@acme/icons" }]);
    expect(await model.replaceLinks("app", [])).toEqual([]);
    expect(await model.listLinks("app")).toEqual([]);
  });

  it("lists usage for one story file", async () => {
    const { db } = makeDatabase();
    const model = new PackageUsageModel(db);
    await model.replaceForBuild("p1", "b1", [
      row,
      { ...row, storyImportPath: "src/Other.stories.tsx" },
    ]);
    expect(await model.listForStory("b1", "src/Card.stories.tsx")).toHaveLength(1);
  });
});

const reportA = [row, { ...row, storyImportPath: "src/A.stories.tsx" }];
const reportB = [{ ...row, version: "3.0.0" }];

function withoutTransact(db: DatabaseAdapter): DatabaseAdapter {
  const { transact: _omit, ...rest } = db;
  return rest as DatabaseAdapter;
}

describe("PackageUsageModel concurrency and atomicity", () => {
  it.each([
    ["with transact", (db: DatabaseAdapter) => db],
    ["without transact", withoutTransact],
  ])("concurrent replaceForBuild leaves exactly one report (%s)", async (_label, wrap) => {
    const { db } = makeDatabase();
    const model = new PackageUsageModel(wrap(db));
    await Promise.all([
      model.replaceForBuild("p1", "b1", reportA),
      model.replaceForBuild("p1", "b1", reportB),
      model.replaceForBuild("p1", "b1", reportA),
    ]);
    const stored = await model.listForBuild("b1");
    expect(stored).toHaveLength(reportA.length);
    expect(new Set(stored.map((r) => r.version))).toEqual(new Set(["2.4.0"]));
  });

  it("rolls back a failed replace so the previous report survives", async () => {
    const { db } = makeDatabase();
    const model = new PackageUsageModel(db);
    await model.replaceForBuild("p1", "b1", reportA);
    const failing: DatabaseAdapter = {
      ...db,
      transact: async (work) =>
        await db.transact!(async (tx) =>
          work({
            ...tx,
            insert: async () => {
              throw new Error("boom");
            },
          }),
        ),
    };
    await expect(
      new PackageUsageModel(failing).replaceForBuild("p1", "b1", reportB),
    ).rejects.toThrow("boom");
    expect(await model.listForBuild("b1")).toHaveLength(reportA.length);
  });

  it("serializes concurrent replaceLinks without transact", async () => {
    const { db } = makeDatabase();
    const model = new PackageUsageModel(withoutTransact(db));
    await Promise.all([
      model.replaceLinks("app", [{ upstreamId: "ds", packageName: "@acme/ds" }]),
      model.replaceLinks("app", [{ upstreamId: "ds2", packageName: "@acme/icons" }]),
    ]);
    expect(await model.listLinks("app")).toMatchObject([{ packageName: "@acme/icons" }]);
  });

  it("removes a build's usage rows explicitly", async () => {
    const { db } = makeDatabase();
    const model = new PackageUsageModel(db);
    await model.replaceForBuild("p1", "b1", reportA);
    await model.replaceForBuild("p1", "b2", reportB);
    expect(await model.removeForBuild("b1")).toBe(reportA.length);
    expect(await model.listForBuild("b1")).toEqual([]);
    expect(await model.listForBuild("b2")).toHaveLength(1);
  });
});

describe("matchUpstreamStory", () => {
  const stories = [
    { importPath: "src/Button.stories.tsx", storyId: "button--secondary" },
    { importPath: "src/Button.stories.tsx", storyId: "button--primary" },
    { importPath: "src/Tag.stories.tsx", storyId: "tag--default" },
    { importPath: "src/a/Card.stories.tsx", storyId: "a-card--x" },
    { importPath: "src/b/Card.stories.tsx", storyId: "b-card--x" },
  ];

  it("matches by component stem and returns the first story id", () => {
    expect(matchUpstreamStory("node_modules/@acme/ds/dist/Button.js", stories)).toBe(
      "button--primary",
    );
    expect(matchUpstreamStory("packages/ds/src/Tag/index.tsx", stories)).toBe("tag--default");
  });

  it("returns null for no match or ambiguous stems", () => {
    expect(matchUpstreamStory("dist/Missing.js", stories)).toBeNull();
    expect(matchUpstreamStory("dist/Card.js", stories)).toBeNull();
    expect(matchUpstreamStory("", stories)).toBeNull();
  });
});
