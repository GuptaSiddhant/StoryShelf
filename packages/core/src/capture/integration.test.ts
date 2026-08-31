import { describe, expect, it } from "vitest";

import type { DatabaseAdapter, StorageAdapter } from "../adapters/database.ts";
import { makeDatabase, makeStorage } from "./fake-adapters.ts";
import { BuildModel } from "../models/build.ts";
import { ProjectModel } from "../models/project.ts";
import { SnapshotModel } from "../models/snapshot.ts";
import type { RenderedSnapshot } from "../capture/adapter.ts";
import { createShelfRouter } from "../index.tsx";

const mockProject = {
  id: "p1",
  name: "Fixture",
  slug: "fixture",
  gitRepository: null,
  gitDefaultBranch: "main",
  pixelThreshold: 0.1,
  maxDiffRatio: 0.01,
  publicBranchRegex: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function storyOf(id: string) {
  return { id, title: "Components/Button", name: id, type: "story" };
}

function png(width: number, height: number, rgb: [number, number, number]): Buffer {
  const [red, green, blue] = rgb;
  const image = new PNG({ width, height });
  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = red;
    image.data[index + 1] = green;
    image.data[index + 2] = blue;
    image.data[index + 3] = 255;
  }
  return Buffer.from(PNG.sync.write(image));
}

function renderSnapshot(story: RenderedSnapshot["story"], viewportName: string, screenshot: Buffer): RenderedSnapshot {
  return { story, viewportName, screenshot };
}

function makeApp() {
  return createShelfRouter({
    database: makeDatabase().db,
    storage: makeStorage(),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });
}

describe("Capture pipeline integration", () => {
  it("creates project via API route", async () => {
    const app = makeApp();

    const response = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Test Project", slug: "test-project" }),
    });
    expect(response.status).toBe(201);
    const createdProject = await response.json();
    expect(createdProject.name).toBe("Test Project");
    expect(createdProject.slug).toBe("test-project");
  });

  it("lists projects via API", async () => {
    const app = makeApp();

    const response = await app.request("/api/v1/projects");
    expect(response.status).toBe(200);
    const projectsList = await response.json();
    expect(Array.isArray(projectsList)).toBe(true);
  });

  it("creates and reviews a snapshot", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const project = await new ProjectModel(db).create({
      name: "Snapshot Test",
      slug: "snapshot-test",
      gitDefaultBranch: "main",
    });
    const build = await new BuildModel(db).create(project.id, { gitSha: "sha-abc", gitBranch: "main", isDefault: true });

    const snapshot = await new SnapshotModel(db).create(project.id, build.id, {
      storyId: "components-button--primary",
      storyName: "Components/Button",
      storyTitle: "Components/Button",
      storyImportPath: "./Button.stories.tsx",
      viewportName: "desktop",
      viewportWidth: 800,
      viewportHeight: 600,
      screenshotPath: `/screenshots/${build.id}-test.png`,
    });

    await new SnapshotModel(db).review(snapshot.id, "approved", "user-1");
    const updatedSnapshot = await new SnapshotModel(db).get(snapshot.id);
    expect(updatedSnapshot?.status).toBe("approved");
  });

  it("validates OpenAPI schema has all expected paths", async () => {
    const app = makeApp();

    const response = await app.request("/api/v1/openapi.json");
    expect(response.status).toBe(200);
    const doc = (await response.json()) as { openapi: string; info: { title: string; version: string }; paths: Record<string, unknown> };
    expect(doc.openapi).toBe("3.0.0");
    expect(doc.info.title).toBe("StoryShelf API");

    expect(doc.paths["/api/v1/projects"]).toBeDefined();
    expect(doc.paths["/api/v1/projects/{slug}"]).toBeDefined();
    expect(doc.paths["/api/v1/projects/{slug}/builds"]).toBeDefined();
    expect(doc.paths["/api/v1/admin/purge"]).toBeDefined();
  });
});