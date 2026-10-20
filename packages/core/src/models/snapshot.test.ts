import { describe, expect, it } from "vitest";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { SnapshotModel } from "./snapshot.ts";

/** A snapshot row for the timing cases, with the duration the renderer reported (or none). */
function timedRow(storyId: string, viewportName: string, durationMs: number | null) {
  return {
    storyId,
    storyName: storyId,
    storyTitle: storyId,
    storyImportPath: "",
    viewportName,
    viewportWidth: 1280,
    viewportHeight: 720,
    screenshotPath: `/${storyId}-${viewportName}.png`,
    durationMs,
  };
}

describe("SnapshotModel", () => {
  it("creates a snapshot for a build", async () => {
    const { db } = makeDatabase();
    const model = new SnapshotModel(db, { snapshots: db.tables.snapshots });
    const snapshot = await model.create("p1", "b1", {
      storyId: "a",
      storyName: "A",
      storyTitle: "Component A",
      storyImportPath: "./A.stories.tsx",
      viewportName: "desktop",
      viewportWidth: 1280,
      viewportHeight: 720,
      screenshotPath: "/path/to/screenshot.png",
    });
    expect(snapshot.id).toBeDefined();
    expect(snapshot.storyId).toBe("a");
    expect(snapshot.storyName).toBe("A");
    expect(snapshot.viewportName).toBe("desktop");
    expect(snapshot.status).toBe("pending");
  });

  it("sums each story's recorded durations for a build", async () => {
    const { db } = makeDatabase();
    const model = new SnapshotModel(db, { snapshots: db.tables.snapshots });
    await model.create("p1", "b1", timedRow("a", "desktop", 300));
    await model.create("p1", "b1", timedRow("a", "mobile", 200));
    await model.create("p1", "b1", timedRow("b", "desktop", 50));
    // Untimed rows (an inherited snapshot, or a runner that reports none) are left out entirely.
    await model.create("p1", "b1", timedRow("c", "desktop", null));
    await model.create("p1", "b2", timedRow("a", "desktop", 999));

    const timings = await model.durationsByStory("b1");

    expect(Object.fromEntries(timings)).toEqual({ a: 500, b: 50 });
    expect(timings.has("c")).toBe(false);
  });

  it("lists snapshots by build", async () => {
    const { db } = makeDatabase();
    const model = new SnapshotModel(db, { snapshots: db.tables.snapshots });
    await model.create("p1", "b1", {
      storyId: "a",
      storyName: "A",
      storyTitle: "A",
      storyImportPath: "",
      viewportName: "desktop",
      viewportWidth: 1280,
      viewportHeight: 720,
      screenshotPath: "/path/a.png",
    });
    await model.create("p1", "b1", {
      storyId: "b",
      storyName: "B",
      storyTitle: "B",
      storyImportPath: "",
      viewportName: "mobile",
      viewportWidth: 320,
      viewportHeight: 480,
      screenshotPath: "/path/b.png",
    });

    const rows = await model.listByBuild("b1");
    expect(rows).toHaveLength(2);
    expect(rows.map((s) => s.storyName)).toContain("A");
    expect(rows.map((s) => s.storyName)).toContain("B");
  });

  it("gets a snapshot by id", async () => {
    const { db } = makeDatabase();
    const model = new SnapshotModel(db, { snapshots: db.tables.snapshots });
    const snapshot = await model.create("p1", "b1", {
      storyId: "a",
      storyName: "A",
      storyTitle: "A",
      storyImportPath: "",
      viewportName: "desktop",
      viewportWidth: 1280,
      viewportHeight: 720,
      screenshotPath: "/path/a.png",
    });
    const fetched = await model.get(snapshot.id);
    expect(fetched?.id).toBe(snapshot.id);
    expect(fetched?.storyName).toBe("A");
  });

  it("upplies snapshot status", async () => {
    const { db } = makeDatabase();
    const model = new SnapshotModel(db, { snapshots: db.tables.snapshots });
    const snapshot = await model.create("p1", "b1", {
      storyId: "a",
      storyName: "A",
      storyTitle: "A",
      storyImportPath: "",
      viewportName: "desktop",
      viewportWidth: 1280,
      viewportHeight: 720,
      screenshotPath: "/path/a.png",
    });
    const updated = await model.setStatus(snapshot.id, "approved" as const);
    expect(updated.status).toBe("approved");
  });

  it("records reviewer decision", async () => {
    const { db } = makeDatabase();
    const model = new SnapshotModel(db, { snapshots: db.tables.snapshots });
    const snapshot = await model.create("p1", "b1", {
      storyId: "a",
      storyName: "A",
      storyTitle: "A",
      storyImportPath: "",
      viewportName: "desktop",
      viewportWidth: 1280,
      viewportHeight: 720,
      screenshotPath: "/path/a.png",
    });
    const updated = await model.review(snapshot.id, "approved" as const, "user-1");
    expect(updated.status).toBe("approved");
    expect(updated.reviewedBy).toBe("user-1");
  });

  it("removes snapshot indirectly via build cascade", async () => {
    const { db } = makeDatabase();
    const model = new SnapshotModel(db, { snapshots: db.tables.snapshots });
    const snap = await model.create("p1", "b1", {
      storyId: "a",
      storyName: "A",
      storyTitle: "A",
      storyImportPath: "",
      viewportName: "desktop",
      viewportWidth: 1280,
      viewportHeight: 720,
      screenshotPath: "/path/a.png",
    });
    expect(snap.id).toBeDefined();
  });
});

describe("SnapshotModel.listByImportPath", () => {
  it("matches both ./ and bare spellings within one project", async () => {
    const { db } = makeDatabase();
    const model = new SnapshotModel(db);
    const base = {
      storyName: "x",
      storyTitle: "T",
      viewportName: "desktop",
      viewportWidth: 1,
      viewportHeight: 1,
      screenshotPath: "p",
    };
    await model.create("p1", "b1", {
      ...base,
      storyId: "a",
      storyImportPath: "./src/A.stories.tsx",
    });
    await model.create("p1", "b2", { ...base, storyId: "a", storyImportPath: "src/A.stories.tsx" });
    await model.create("p1", "b2", {
      ...base,
      storyId: "b",
      storyImportPath: "./src/B.stories.tsx",
    });
    await model.create("p2", "b3", {
      ...base,
      storyId: "a",
      storyImportPath: "./src/A.stories.tsx",
    });
    const found = await model.listByImportPath("p1", "./src/A.stories.tsx");
    expect(new Set(found.map((snap) => snap.buildId))).toEqual(new Set(["b1", "b2"]));
    expect(await model.listByImportPath("p1", "src/A.stories.tsx")).toHaveLength(2);
    expect(await model.listByImportPath("p1", "nope.tsx")).toEqual([]);
  });

  it("removes only the rendered rows of the (story, engine) pairs a shard rewrites", async () => {
    const { db } = makeDatabase();
    const model = new SnapshotModel(db, { snapshots: db.tables.snapshots });
    const row = (storyId: string, browser: string, inherited: boolean) =>
      model.create("p1", "b1", { ...timedRow(storyId, "desktop", null), browser, inherited });
    await row("a", "chromium", true);
    await row("a", "firefox", false);
    await row("a", "chromium", false);
    await row("b", "firefox", false);
    await model.create("p1", "b2", { ...timedRow("a", "desktop", null), browser: "firefox" });

    const removed = await model.removeRendered("b1", [
      { browser: "firefox", storyIds: new Set(["a"]) },
    ]);

    expect(removed).toBe(1);
    const left = (await model.listByBuild("b1")).map(
      (s) => `${s.storyId}:${s.browser}:${s.inherited}`,
    );
    expect(left).toHaveLength(3);
    expect(new Set(left)).toEqual(
      new Set(["a:chromium:false", "a:chromium:true", "b:firefox:false"]),
    );
    expect(await model.listByBuild("b2")).toHaveLength(1);
    expect(await model.removeForBuild("b1")).toBe(3);
    expect(await model.listByBuild("b1")).toEqual([]);
  });
});
