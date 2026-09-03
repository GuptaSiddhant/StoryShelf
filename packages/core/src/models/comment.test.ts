import { describe, expect, it } from "vitest";

import type { DatabaseAdapter } from "../adapters/database.ts";
import { projects } from "../schema.ts";
import { makeDatabase } from "../capture/fake-adapters.ts";
import { CommentModel } from "./comment.ts";

const mockProject = {
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

async function makeDbWithProject(): Promise<DatabaseAdapter> {
  const { db } = makeDatabase();
  await db.insert(projects, {
    id: mockProject.id,
    name: mockProject.name,
    slug: mockProject.slug,
    gitRepository: mockProject.gitRepository,
    gitDefaultBranch: mockProject.gitDefaultBranch,
    pixelThreshold: mockProject.pixelThreshold,
    maxDiffRatio: mockProject.maxDiffRatio,
    publicBranchRegex: mockProject.publicBranchRegex,
    executePlay: mockProject.executePlay,
    playTimeoutMs: mockProject.playTimeoutMs,
    createdAt: mockProject.createdAt,
    updatedAt: mockProject.updatedAt,
  });
  return db;
}

describe("CommentModel", () => {
  it("creates a comment on a build when project exists", async () => {
    const db = await makeDbWithProject();
    const model = new CommentModel(db);
    const comment = await model.create(mockProject.id, "b1", "user-123", { body: "Great component!" });
    expect(comment.id).toBeDefined();
    expect(comment.body).toBe("Great component!");
    expect(comment.projectId).toBe(mockProject.id);
    expect(comment.buildId).toBe("b1");
    expect(comment.userId).toBe("user-123");
    expect(comment.resolved).toBe(false);
  });

  it("throws when project does not exist", async () => {
    const { db } = makeDatabase();
    const model = new CommentModel(db);
    await expect(model.create("nonexistent-id", "b1", "user-123", { body: "comment" })).rejects.toThrow(
      "Project not found: nonexistent-id",
    );
  });

  it("lists comments by build", async () => {
    const db = await makeDbWithProject();
    const model = new CommentModel(db);

    await model.create(mockProject.id, "b1", "user-1", { body: "First comment" });
    await model.create(mockProject.id, "b1", "user-2", { body: "Second comment" });

    const comments = await model.listByBuild("b1");
    expect(comments).toHaveLength(2);
    expect(comments.map((c) => c.body)).toContain("First comment");
    expect(comments.map((c) => c.body)).toContain("Second comment");
  });

  it("resolves a comment", async () => {
    const db = await makeDbWithProject();
    const model = new CommentModel(db);

    const comment = await model.create(mockProject.id, "b1", "user-1", { body: "Comment to resolve" });
    const resolvedComment = await model.resolve(comment.id);
    expect(resolvedComment.resolved).toBe(true);
  });
});
