import { LabelModel } from "@storyshelf/core/models";
import type { Build } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it, vi } from "vite-plus/test";
import { createShelfApp } from "../index.tsx";
const silentLogger = pino({ level: "silent" });

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
    executePlay: false,
    playTimeoutMs: 10_000,
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
    inheritedCount: 0,
    affectedOnly: true,
    baselineSha: null,
    changedFiles: null,
    affectedImportPaths: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("creates and lists label types", async () => {
    const { db } = makeDatabase();
    await db.insert(db.tables.projects, mockProject);
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
    await db.insert(db.tables.projects, mockProject);
    await db.insert(db.tables.builds, mockBuild);
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
    await db.insert(db.tables.projects, mockProject);
    await db.insert(db.tables.builds, mockBuild);
    const labelModel = new LabelModel(db);

    await labelModel.attach("p1", "b1", "branch", "main");

    const latestBuildId = await labelModel.latestBuildId("p1", "branch", "main");
    expect(latestBuildId).toBe("b1");
  });

  it("returns null for non-existent label", async () => {
    const { db } = makeDatabase();
    await db.insert(db.tables.projects, mockProject);
    const labelModel = new LabelModel(db);

    const latestBuildId = await labelModel.latestBuildId("p1", "branch", "nonexistent");
    expect(latestBuildId).toBeNull();
  });

  it("checks persistent label", async () => {
    const { db } = makeDatabase();
    await db.insert(db.tables.projects, mockProject);
    await db.insert(db.tables.builds, mockBuild);
    const labelModel = new LabelModel(db);

    expect(await labelModel.hasPersistent("p1", "b1")).toBe(false);

    await labelModel.attach("p1", "b1", "persistent", "true");

    expect(await labelModel.hasPersistent("p1", "b1")).toBe(true);
  });

  it("removes custom label types", async () => {
    const { db } = makeDatabase();
    await db.insert(db.tables.projects, mockProject);
    const labelModel = new LabelModel(db);

    await labelModel.createType("p1", { key: "custom", name: "Custom" });
    await labelModel.removeType("p1", "custom");

    const types = await labelModel.listTypes("p1");
    expect(types).toHaveLength(0);
  });

  it("rejects removal of reserved label types", async () => {
    const { db } = makeDatabase();
    await db.insert(db.tables.projects, mockProject);
    const labelModel = new LabelModel(db);

    await expect(labelModel.removeType("p1", "persistent")).rejects.toThrow(
      "Label type 'persistent' cannot be removed.",
    );
  });
});

describe("PATCH label-type endpoint", () => {
  const localProject: Project = {
    id: "p1",
    name: "Test Project",
    slug: "test-project",
    gitRepository: null,
    gitDefaultBranch: "main",
    pixelThreshold: 0.1,
    maxDiffRatio: 0.01,
    publicBranchRegex: null,
    executePlay: false,
    playTimeoutMs: 10_000,
    storybookMeta: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("updates a custom label type", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await db.insert(db.tables.projects, localProject);
    const labelModel = new LabelModel(db);
    await labelModel.createType("p1", {
      key: "custom",
      name: "Custom",
      linkTemplate: "https://x/{value}",
      color: "#fff",
    });
    const app = createShelfApp({ database: db, storage, logger: silentLogger });

    const response = await app.request("/api/v1/projects/test-project/label-types/custom", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Renamed", color: null }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      name: string;
      color: string | null;
      linkTemplate: string;
    };
    expect(body.name).toBe("Renamed");
    expect(body.color).toBeNull();
    expect(body.linkTemplate).toBe("https://x/{value}");
  });

  it("returns 404 when patching a non-existent label type", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await db.insert(db.tables.projects, localProject);
    const app = createShelfApp({ database: db, storage, logger: silentLogger });
    const response = await app.request("/api/v1/projects/test-project/label-types/missing", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "X" }),
    });
    expect(response.status).toBe(404);
  });

  it("answers 409 with the model's message when the project already has the key", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await db.insert(db.tables.projects, localProject);
    const app = createShelfApp({ database: db, storage, logger: silentLogger });
    const create = async () =>
      await app.request("/api/v1/projects/test-project/label-types", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: "jira", name: "Jira" }),
      });

    expect((await create()).status).toBe(201);
    const again = await create();

    expect(again.status).toBe(409);
    expect(await again.text()).toContain("A label type with the key 'jira' already exists.");
  });

  it("answers 409, not 500, to the create that loses a race for the key", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await db.insert(db.tables.projects, localProject);
    const app = createShelfApp({ database: db, storage, logger: silentLogger });
    const insert = db.insert.bind(db);
    // The other request lands between this one's check and its insert; the unique index turns this one away.
    vi.spyOn(db, "insert").mockImplementationOnce(async (table, values) => {
      await insert(table, { ...values, id: "winner" } as never);
      throw new Error("UNIQUE constraint failed: label_types.project_id, label_types.key");
    });

    const response = await app.request("/api/v1/projects/test-project/label-types", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "jira", name: "Jira" }),
    });

    expect(response.status).toBe(409);
    const text = await response.text();
    expect(text).toContain("A label type with the key 'jira' already exists.");
    expect(text).not.toContain("UNIQUE");
  });

  it("answers 400 with the reason when a reserved label type is deleted", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await db.insert(db.tables.projects, localProject);
    const app = createShelfApp({ database: db, storage, logger: silentLogger });

    const response = await app.request("/api/v1/projects/test-project/label-types/persistent", {
      method: "DELETE",
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Label type 'persistent' cannot be removed.");
  });

  it("deletes a custom label type", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await db.insert(db.tables.projects, localProject);
    await new LabelModel(db).createType("p1", { key: "custom", name: "Custom" });
    const app = createShelfApp({ database: db, storage, logger: silentLogger });

    const response = await app.request("/api/v1/projects/test-project/label-types/custom", {
      method: "DELETE",
    });

    expect(response.status).toBe(204);
    expect(await new LabelModel(db).listTypes("p1")).toHaveLength(0);
  });

  it("rejects patching a reserved label type", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await db.insert(db.tables.projects, localProject);
    const app = createShelfApp({ database: db, storage, logger: silentLogger });
    const response = await app.request("/api/v1/projects/test-project/label-types/persistent", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "X" }),
    });
    expect(response.status).toBe(400);
  });
});
