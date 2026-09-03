import { describe, expect, it } from "vitest";
import { BuildModel, isPublicBuild } from "./build.ts";
import { ProjectModel } from "./project.ts";
import { projects, snapshots } from "../schema.ts";
import { makeDatabase } from "../capture/fake-adapters.ts";

describe("BuildModel", () => {
  it("creates a build with default status pending", async () => {
    const { db } = makeDatabase();
    const model = new BuildModel(db);
    const project = await new ProjectModel(db).create({
      name: "Test",
      gitRepository: "owner/repo",
    });
    const build = await model.create(project.id, {
      gitSha: "abc123",
      gitBranch: "main",
    });
    expect(build.id).toBeDefined();
    expect(build.gitSha).toBe("abc123");
    expect(build.gitBranch).toBe("main");
    expect(build.status).toBe("pending");
    expect(build.isDefault).toBe(false);
  });

  it("gets a build by id", async () => {
    const { db } = makeDatabase();
    const model = new BuildModel(db);
    const build = await model.create("p1", { gitSha: "sha-1", gitBranch: "main" });
    const fetched = await model.get(build.id);
    expect(fetched?.id).toBe(build.id);
    expect(fetched?.gitSha).toBe("sha-1");
  });

  it("updates build status", async () => {
    const { db } = makeDatabase();
    const model = new BuildModel(db);
    const build = await model.create("p1", { gitSha: "sha-1", gitBranch: "main" });
    const updated = await model.setStatus(build.id, "capturing" as const);
    expect(updated.status).toBe("capturing");
  });

  it("recomputes build counts", async () => {
    const { db } = makeDatabase();
    const model = new BuildModel(db);
    const build = await model.create("p1", { gitSha: "sha-1", gitBranch: "main" });

    await db.insert(snapshots, {
      id: "s1", projectId: "p1", buildId: build.id, storyId: "a", storyName: "A",
      storyTitle: "A", storyImportPath: "", viewportName: "desktop",
      viewportWidth: 1280, viewportHeight: 720, screenshotPath: "/path",
      status: "approved", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await db.insert(snapshots, {
      id: "s2", projectId: "p1", buildId: build.id, storyId: "b", storyName: "B",
      storyTitle: "B", storyImportPath: "", viewportName: "desktop",
      viewportWidth: 1280, viewportHeight: 720, screenshotPath: "/path",
      status: "changed", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const updatedBuild = await model.updateCounts(build.id);
    expect(updatedBuild.snapshotCount).toBe(2);
    expect(updatedBuild.approvedCount).toBe(1);
    expect(updatedBuild.changedCount).toBe(1);
  });

  it("removes a build", async () => {
    const { db } = makeDatabase();
    const model = new BuildModel(db);
    const build = await model.create("p1", { gitSha: "sha-1", gitBranch: "main" });
    await model.remove(build.id);
    const deleted = await model.get(build.id);
    expect(deleted).toBeNull();
  });
});

function publicTestProject(publicBranchRegex: string | null): { publicBranchRegex: string | null } {
  return { publicBranchRegex };
}

describe("isPublicBuild", () => {
  it("returns true when build.public is set", () => {
    expect(isPublicBuild(publicTestProject(null), { public: true, gitBranch: "feature/x" })).toBe(true);
  });

  it("returns true when the branch matches the project regex", () => {
    expect(isPublicBuild(publicTestProject("^main$|^main$"), { public: false, gitBranch: "main" })).toBe(true);
  });

  it("returns false when no regex is configured", () => {
    expect(isPublicBuild(publicTestProject(null), { public: false, gitBranch: "main" })).toBe(false);
  });

  it("returns false when the branch does not match the regex", () => {
    expect(isPublicBuild(publicTestProject("^main$"), { public: false, gitBranch: "feature/x" })).toBe(false);
  });
});

describe("BuildModel latestPublished", () => {
  it("returns the most recent public build", async () => {
    const { db } = makeDatabase();
    const model = new BuildModel(db);
    const project = await new ProjectModel(db).create({ name: "Test", gitRepository: "owner/repo" });
    const pr = { publicBranchRegex: null,
      executePlay: false,
      playTimeoutMs: 10_000,
    };
    await model.create(project.id, { gitSha: "abc", gitBranch: "main" });
    const publicBuild = await model.create(project.id, { gitSha: "def", gitBranch: "main", public: true });
    const published = await model.latestPublished(project);
    expect(published?.id).toBe(publicBuild.id);
    expect(pr).toBeDefined();
  });

  it("returns the most recent build whose branch matches the project regex", async () => {
    const { db } = makeDatabase();
    const model = new BuildModel(db);
    await db.insert(projects, {
      id: "p1", name: "Test", slug: "test", gitRepository: "owner/repo", gitDefaultBranch: "main",
      pixelThreshold: 0.1, maxDiffRatio: 0.01, publicBranchRegex: "^main$", storybookMeta: null,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await model.create("p1", { gitSha: "abc", gitBranch: "feature/x" });
    const mainBuild = await model.create("p1", { gitSha: "def", gitBranch: "main" });
    const project = { id: "p1", publicBranchRegex: "^main$" };
    const published = await model.latestPublished(project);
    expect(published?.id).toBe(mainBuild.id);
  });

  it("returns null when no build is public", async () => {
    const { db } = makeDatabase();
    const model = new BuildModel(db);
    const project = await new ProjectModel(db).create({ name: "Test", gitRepository: "owner/repo" });
    await model.create(project.id, { gitSha: "abc", gitBranch: "feature/x" });
    const published = await model.latestPublished(project);
    expect(published).toBeNull();
  });
});
