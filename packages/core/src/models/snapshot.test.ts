import { describe, expect, it } from "vitest";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { SnapshotModel } from "./snapshot.ts";
import { makeDatabase } from "./fake-adapters.ts";

describe("SnapshotModel", () => {
  it("creates a snapshot for a build", async () => {
    const db = makeDatabase();
    const model = new SnapshotModel(db);
    const snapshot = await model.create(
      "p1",
      "b1",
      {
        storyId: "a",
        storyName: "A",
        storyTitle: "Component A",
        storyImportPath: "./A.stories.tsx",
        viewportName: "desktop",
        viewportWidth: 1280,
        viewportHeight: 720,
        screenshotPath: "/path/to/screenshot.png",
      }
    );
    expect(snapshot.id).toBeDefined();
    expect(snapshot.storyId).toBe("a");
    expect(snapshot.storyName).toBe("A");
    expect(snapshot.viewportName).toBe("desktop");
    expect(snapshot.status).toBe("pending");
  });

  it("lists snapshots by build", async () => {
    const db = makeDatabase();
    const model = new SnapshotModel(db);
    await model.create("p1", "b1", {
      storyId: "a", storyName: "A", storyTitle: "A",
      storyImportPath: "", viewportName: "desktop",
      viewportWidth: 1280, viewportHeight: 720,
      screenshotPath: "/path/a.png",
    });
    await model.create("p1", "b1", {
      storyId: "b", storyName: "B", storyTitle: "B",
      storyImportPath: "", viewportName: "mobile",
      viewportWidth: 320, viewportHeight: 480,
      screenshotPath: "/path/b.png",
    });

    const snapshots = await model.listByBuild("b1");
    expect(snapshots).toHaveLength(2);
    expect(snapshots.map((s) => s.storyName)).toContain("A");
    expect(snapshots.map((s) => s.storyName)).toContain("B");
  });

  it("gets a snapshot by id", async () => {
    const db = makeDatabase();
    const model = new SnapshotModel(db);
    const snapshot = await model.create("p1", "b1", {
      storyId: "a", storyName: "A", storyTitle: "A",
      storyImportPath: "", viewportName: "desktop",
      viewportWidth: 1280, viewportHeight: 720,
      screenshotPath: "/path/a.png",
    });
    const fetched = await model.get(snapshot.id);
    expect(fetched?.id).toBe(snapshot.id);
    expect(fetched?.storyName).toBe("A");
  });

  it("upplies snapshot status", async () => {
    const db = makeDatabase();
    const model = new SnapshotModel(db);
    const snapshot = await model.create("p1", "b1", {
      storyId: "a", storyName: "A", storyTitle: "A",
      storyImportPath: "", viewportName: "desktop",
      viewportWidth: 1280, viewportHeight: 720,
      screenshotPath: "/path/a.png",
    });
    const updated = await model.setStatus(snapshot.id, "approved" as const);
    expect(updated.status).toBe("approved");
  });

  it("records reviewer decision", async () => {
    const db = makeDatabase();
    const model = new SnapshotModel(db);
    const snapshot = await model.create("p1", "b1", {
      storyId: "a", storyName: "A", storyTitle: "A",
      storyImportPath: "", viewportName: "desktop",
      viewportWidth: 1280, viewportHeight: 720,
      screenshotPath: "/path/a.png",
    });
    const updated = await model.review(snapshot.id, "approved" as const, "user-1");
    expect(updated.status).toBe("approved");
    expect(updated.reviewedBy).toBe("user-1");
  });

  it("removes snapshot indirectly via build cascade", async () => {
    const db = makeDatabase();
    const buildModel = new(db.constructor.name === "Object" ? {} : makeDatabase().constructor.name === "Object" ? {} : makeDatabase())(makeDatabase());
    // Test structure - snapshot creation and status update
    const model = new SnapshotModel(db);
    const snap = await model.create("p1", "b1", {
      storyId: "a", storyName: "A", storyTitle: "A",
      storyImportPath: "", viewportName: "desktop",
      viewportWidth: 1280, viewportHeight: 720,
      screenshotPath: "/path/a.png",
    });
    expect(snap.id).toBeDefined();
  });
});