import { describe, expect, it } from "vitest";
import { SnapshotModel } from "../models/snapshot.ts";
import { makeDatabase } from "../test-helpers/index.ts";
import { inheritedA11yJson } from "./inherited-a11y.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const FINDING = "image-alt (critical): Images must have alternative text [img] 2 nodes";

async function seed(a11yViolations: string | null, withBuild = true) {
  const { db } = makeDatabase();
  if (withBuild) {
    await db.insert(db.tables.builds, {
      id: "src-build",
      projectId: "p1",
      gitSha: "0123456789abcdef",
      gitBranch: "main",
      isDefault: true,
      status: "approved",
      createdAt: NOW,
      updatedAt: NOW,
    } as never);
  }
  const snapshot = await new SnapshotModel(db).create("p1", "src-build", {
    storyId: "a",
    storyName: "a",
    storyTitle: "A",
    viewportName: "desktop",
    viewportWidth: 1280,
    viewportHeight: 720,
    screenshotPath: "p1/a.png",
    a11yViolations,
  });
  return { db, snapshotId: snapshot.id };
}

describe("inheritedA11yJson", () => {
  it("carries the source findings behind a note naming the baseline's short sha", async () => {
    const { db, snapshotId } = await seed(JSON.stringify([FINDING, "…and 3 more"]));
    const json = await inheritedA11yJson(db, db.tables, { snapshotId, buildId: "src-build" });
    expect(JSON.parse(json ?? "null")).toEqual(["from baseline 0123456", FINDING, "…and 3 more"]);
  });

  it("leaves the notes of the source run behind", async () => {
    const { db, snapshotId } = await seed(
      JSON.stringify(["axe unavailable: boom", "a11y parameters not serializable: cyclic"]),
    );
    expect(await inheritedA11yJson(db, db.tables, { snapshotId, buildId: "src-build" })).toBeNull();
  });

  it("is null when the source recorded nothing or there is no source snapshot", async () => {
    const { db, snapshotId } = await seed(null);
    expect(await inheritedA11yJson(db, db.tables, { snapshotId, buildId: "src-build" })).toBeNull();
    expect(await inheritedA11yJson(db, db.tables, { snapshotId: null, buildId: "x" })).toBeNull();
    expect(
      await inheritedA11yJson(db, db.tables, { snapshotId: "missing", buildId: "x" }),
    ).toBeNull();
  });

  it("reads a damaged list as empty", async () => {
    const { db, snapshotId } = await seed("{not json");
    expect(await inheritedA11yJson(db, db.tables, { snapshotId, buildId: "src-build" })).toBeNull();
  });

  it("names the sha unknown when the baseline's build is gone", async () => {
    const { db, snapshotId } = await seed(JSON.stringify([FINDING]), false);
    const json = await inheritedA11yJson(db, db.tables, { snapshotId, buildId: "src-build" });
    expect(JSON.parse(json ?? "null")).toEqual(["from baseline unknown", FINDING]);
  });
});
