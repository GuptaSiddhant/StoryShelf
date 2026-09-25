import { LabelModel } from "@storyshelf/core/models";
import type { Build } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { storybookZipPath } from "@storyshelf/core/utils";
import { Readable } from "node:stream";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
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
    await db.insert(db.tables.projects, project);
    await db.insert(db.tables.builds, makeBuild("b1"));
    await db.insert(db.tables.builds, makeBuild("b2"));

    const labelModel = new LabelModel(db);
    await labelModel.attach("p1", "b1", "environment", "staging");
    await labelModel.attach("p1", "b2", "environment", "production");

    const app = createShelfApp({ database: db, storage, logger: silentLogger });
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
    await db.insert(db.tables.projects, project);
    await db.insert(db.tables.builds, makeBuild("b1"));

    const app = createShelfApp({ database: db, storage, logger: silentLogger });
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
    await db.insert(db.tables.projects, project);
    await db.insert(db.tables.builds, makeBuild("b1", "main"));
    await db.insert(db.tables.builds, makeBuild("b2", "feature/x"));

    const labelModel = new LabelModel(db);
    await labelModel.attach("p1", "b1", "environment", "staging");
    await labelModel.attach("p1", "b2", "environment", "staging");

    const app = createShelfApp({ database: db, storage, logger: silentLogger });
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
    await db.insert(db.tables.projects, project);
    await db.insert(db.tables.builds, makeBuild("b1"));
    await db.insert(db.tables.builds, makeBuild("b2"));

    const app = createShelfApp({ database: db, storage, logger: silentLogger });
    const response = await app.request("/api/v1/projects/test-project/builds");

    expect(response.status).toBe(200);
    const body = (await response.json()) as Build[];
    expect(body).toHaveLength(2);
  });
});

describe("streaming build upload (JSON + PUT)", () => {
  const project: Project = {
    id: "p1",
    name: "Stream Project",
    slug: "stream-project",
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

  interface CreatedBody {
    build: Build;
    uploadUrl: string;
  }

  async function setupSeeded(): Promise<{
    db: ReturnType<typeof makeDatabase>["db"];
    storage: ReturnType<typeof makeStorage>["storage"];
    app: ReturnType<typeof createShelfApp>;
  }> {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await db.insert(db.tables.projects, project);
    const app = createShelfApp({ database: db, storage, logger: silentLogger });
    return { db, storage, app };
  }

  const defaultPayload: Record<string, unknown> = {
    gitSha: "sha-1",
    gitBranch: "main",
    message: "hello",
    labels: [{ key: "pr", value: "7" }],
  };

  async function createViaJson(
    app: ReturnType<typeof createShelfApp>,
    payload: Record<string, unknown>,
  ): Promise<CreatedBody> {
    const response = await app.request("/api/v1/projects/stream-project/builds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(response.status).toBe(202);
    return (await response.json()) as CreatedBody;
  }

  it("creates a build via JSON with labels and no stored bytes yet", async () => {
    const { db, storage, app } = await setupSeeded();
    const created = await createViaJson(app, defaultPayload);

    expect(created.build.gitSha).toBe("sha-1");
    expect(created.build.status).toBe("pending");
    expect(created.uploadUrl).toBe(
      `/api/v1/projects/stream-project/builds/${created.build.id}/zip`,
    );
    expect(await storage.exists(storybookZipPath("p1", created.build.id))).toBe(false);
    const labels = await new LabelModel(db).listForBuild(created.build.id);
    expect(labels.map((label) => `${label.typeKey}=${label.value}`)).toEqual(["pr=7"]);
  });

  it("streams the zip with PUT and stores byte-identical content", async () => {
    const { storage, app } = await setupSeeded();
    const created = await createViaJson(app, defaultPayload);
    const payload = Buffer.from("PK-zip-bytes-".repeat(5000));

    const response = await app.request(created.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "application/zip" },
      body: payload,
    });

    expect(response.status).toBe(202);
    expect(await storage.read(storybookZipPath("p1", created.build.id))).toEqual(payload);
  });

  it("streams a node Readable end to end", async () => {
    const { storage, app } = await setupSeeded();
    const created = await createViaJson(app, defaultPayload);
    const payload = Buffer.from("readable-bytes-".repeat(2000));

    const response = await app.request(created.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "application/zip" },
      body: Readable.from([payload]) as unknown as BodyInit,
      duplex: "half",
    } as RequestInit);

    expect(response.status).toBe(202);
    expect(await storage.read(storybookZipPath("p1", created.build.id))).toEqual(payload);
  });

  it("rejects JSON without sha with 400", async () => {
    const { app } = await setupSeeded();
    const response = await app.request("/api/v1/projects/stream-project/builds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gitSha: "", gitBranch: "main" }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects PUT for unknown builds with 404", async () => {
    const { app } = await setupSeeded();
    const response = await app.request("/api/v1/projects/stream-project/builds/nope/zip", {
      method: "PUT",
      headers: { "content-type": "application/zip" },
      body: Buffer.from("x"),
    });
    expect(response.status).toBe(404);
  });

  it("rejects oversize uploads with 413", async () => {
    const { db } = makeDatabase();
    const { storage: memStorage } = makeStorage();
    await db.insert(db.tables.projects, project);
    const app = createShelfApp({
      database: db,
      storage: memStorage,
      logger: silentLogger,
      config: { maxUploadBytes: 4 },
    });
    const created = await createViaJson(app, defaultPayload);
    const response = await app.request(created.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "application/zip" },
      body: Buffer.from("way-too-long-payload"),
    });
    expect(response.status).toBe(413);
  });
});
