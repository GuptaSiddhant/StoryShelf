import { describe, expect, it } from "vitest";

import { makeDatabase } from "../capture/fake-adapters.ts";
import { LabelModel } from "../models/label.ts";
import { builds, projects, type Build, type Project } from "../schema.ts";

describe("Label-driven build resolution", () => {
  const mockProject: Project = {
    id: "p1",
    name: "Test Project",
    slug: "test-project",
    gitRepository: null,
    gitDefaultBranch: "main",
    pixelThreshold: 0.1,
    maxDiffRatio: 0.01,
    publicBranchRegex: null,
      storybookMeta: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const mockBuild: Build = {
    id: "b1",
    projectId: "p1",
    gitSha: "sha-1",
    gitBranch: "main",
    isDefault: true,
    authorEmail: null,
    authorName: null,
    message: null,
    public: false,
    status: "approved",
    snapshotCount: 0,
    changedCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("creates and lists label types", async () => {
    const { db } = makeDatabase();
    await db.insert(projects, mockProject);
    const labelModel = new LabelModel(db);

    const labelType = await labelModel.createType("p1", {
      key: "custom",
      name: "Custom Label",
      linkTemplate: "https://example.com/{{value}}",
      color: "#ff0000",
    });

    expect(labelType.key).toBe("custom");
    expect(labelType.name).toBe("Custom Label");

    const types = await labelModel.listTypes("p1");
    expect(types).toHaveLength(1);
    expect(types[0]?.key).toBe("custom");
  });

  it("attaches labels to builds", async () => {
    const { db } = makeDatabase();
    await db.insert(projects, mockProject);
    await db.insert(builds, mockBuild);
    const labelModel = new LabelModel(db);

    const label = await labelModel.attach("p1", "b1", "branch", "main");
    expect(label.buildId).toBe("b1");
    expect(label.typeKey).toBe("branch");
    expect(label.value).toBe("main");

    const labels = await labelModel.listForBuild("b1");
    expect(labels).toHaveLength(1);
    expect(labels[0]?.typeKey).toBe("branch");
  });

  it("finds latest build by label", async () => {
    const { db } = makeDatabase();
    await db.insert(projects, mockProject);
    await db.insert(builds, mockBuild);
    const labelModel = new LabelModel(db);

    await labelModel.attach("p1", "b1", "branch", "main");

    const latestBuildId = await labelModel.latestBuildId("p1", "branch", "main");
    expect(latestBuildId).toBe("b1");
  });

  it("returns null for non-existent label", async () => {
    const { db } = makeDatabase();
    await db.insert(projects, mockProject);
    const labelModel = new LabelModel(db);

    const latestBuildId = await labelModel.latestBuildId("p1", "branch", "nonexistent");
    expect(latestBuildId).toBeNull();
  });

  it("checks persistent label", async () => {
    const { db } = makeDatabase();
    await db.insert(projects, mockProject);
    await db.insert(builds, mockBuild);
    const labelModel = new LabelModel(db);

    expect(await labelModel.hasPersistent("p1", "b1")).toBe(false);

    await labelModel.attach("p1", "b1", "persistent", "true");

    expect(await labelModel.hasPersistent("p1", "b1")).toBe(true);
  });

  it("removes custom label types", async () => {
    const { db } = makeDatabase();
    await db.insert(projects, mockProject);
    const labelModel = new LabelModel(db);

    await labelModel.createType("p1", { key: "custom", name: "Custom" });
    await labelModel.removeType("p1", "custom");

    const types = await labelModel.listTypes("p1");
    expect(types).toHaveLength(0);
  });

  it("rejects removal of reserved label types", async () => {
    const { db } = makeDatabase();
    await db.insert(projects, mockProject);
    const labelModel = new LabelModel(db);

    await expect(labelModel.removeType("p1", "persistent")).rejects.toThrow("Label type 'persistent' cannot be removed.");
  });
});
