import { describe, expect, it } from "vitest";
import { pino } from "pino";

import { makeDatabase, makeStorage } from "../capture/fake-adapters.ts";
import { createShelfRouter } from "../index.tsx";
import { LabelModel } from "../models/label.ts";
import { builds, projects, type Build, type Project } from "../schema.ts";

const silentLogger = pino({ level: "silent" });

const makeBuild = (id: string, gitBranch = "main"): Build => ({
  id,
  projectId: "p1",
  gitSha: `sha-${id}`,
  gitBranch,
  isDefault: gitBranch === "main",
  authorEmail: null,
  authorName: null,
  message: null,
  public: false,
  status: "approved",
  snapshotCount: 0,
  changedCount: 0,
  approvedCount: 0,
  rejectedCount: 0,
  createdAt: `2026-01-0${id.at(-1)}T00:00:00.000Z`,
  updatedAt: `2026-01-0${id.at(-1)}T00:00:00.000Z`,
});

describe("build list label filter", () => {
  const project: Project = {
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

  it("filters builds by label value", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await db.insert(projects, project);
    await db.insert(builds, makeBuild("b1"));
    await db.insert(builds, makeBuild("b2"));

    const labelModel = new LabelModel(db);
    await labelModel.attach("p1", "b1", "environment", "staging");
    await labelModel.attach("p1", "b2", "environment", "production");

    const app = createShelfRouter({ database: db, storage, logger: silentLogger });
    const response = await app.request(
      "/api/v1/projects/test-project/builds?labelKey=environment&labelValue=staging",
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Build[];
    expect(body).toHaveLength(1);
    expect(body[0]?.id).toBe("b1");
  });

  it("returns empty when no build carries the label value", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await db.insert(projects, project);
    await db.insert(builds, makeBuild("b1"));

    const app = createShelfRouter({ database: db, storage, logger: silentLogger });
    const response = await app.request(
      "/api/v1/projects/test-project/builds?labelKey=environment&labelValue=missing",
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Build[];
    expect(body).toHaveLength(0);
  });

  it("combines label filter with branch filter", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await db.insert(projects, project);
    await db.insert(builds, makeBuild("b1", "main"));
    await db.insert(builds, makeBuild("b2", "feature/x"));

    const labelModel = new LabelModel(db);
    await labelModel.attach("p1", "b1", "environment", "staging");
    await labelModel.attach("p1", "b2", "environment", "staging");

    const app = createShelfRouter({ database: db, storage, logger: silentLogger });
    const response = await app.request(
      "/api/v1/projects/test-project/builds?labelKey=environment&labelValue=staging&branch=feature/x",
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Build[];
    expect(body).toHaveLength(1);
    expect(body[0]?.id).toBe("b2");
  });

  it("does not filter when label params are absent", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await db.insert(projects, project);
    await db.insert(builds, makeBuild("b1"));
    await db.insert(builds, makeBuild("b2"));

    const app = createShelfRouter({ database: db, storage, logger: silentLogger });
    const response = await app.request("/api/v1/projects/test-project/builds");

    expect(response.status).toBe(200);
    const body = (await response.json()) as Build[];
    expect(body).toHaveLength(2);
  });
});
