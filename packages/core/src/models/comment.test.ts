import { describe, expect, it } from "vitest";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
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
  await db.insert(db.tables.projects, {
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

async function modelOf(): Promise<CommentModel> {
  const db = await makeDbWithProject();
  return new CommentModel(db, { comments: db.tables.comments, projects: db.tables.projects });
}

describe("CommentModel", () => {
  it("creates a comment on a build when project exists", async () => {
    const db = await makeDbWithProject();
    const model = new CommentModel(db, {
      comments: db.tables.comments,
      projects: db.tables.projects,
    });
    const comment = await model.create(mockProject.id, "b1", "user-123", {
      body: "Great component!",
    });
    expect(comment.id).toBeDefined();
    expect(comment.body).toBe("Great component!");
    expect(comment.projectId).toBe(mockProject.id);
    expect(comment.buildId).toBe("b1");
    expect(comment.userId).toBe("user-123");
    expect(comment.resolved).toBe(false);
  });

  it("throws when project does not exist", async () => {
    const { db } = makeDatabase();
    const model = new CommentModel(db, {
      comments: db.tables.comments,
      projects: db.tables.projects,
    });
    await expect(
      model.create("nonexistent-id", "b1", "user-123", { body: "comment" }),
    ).rejects.toThrow("Project not found: nonexistent-id");
  });

  it("lists comments by build", async () => {
    const db = await makeDbWithProject();
    const model = new CommentModel(db, {
      comments: db.tables.comments,
      projects: db.tables.projects,
    });

    await model.create(mockProject.id, "b1", "user-1", { body: "First comment" });
    await model.create(mockProject.id, "b1", "user-2", { body: "Second comment" });

    const rows = await model.listByBuild("b1");
    expect(rows).toHaveLength(2);
    expect(rows.map((c) => c.body)).toContain("First comment");
    expect(rows.map((c) => c.body)).toContain("Second comment");
  });

  it("resolves a comment", async () => {
    const db = await makeDbWithProject();
    const model = new CommentModel(db, {
      comments: db.tables.comments,
      projects: db.tables.projects,
    });

    const comment = await model.create(mockProject.id, "b1", "user-1", {
      body: "Comment to resolve",
    });
    const resolvedComment = await model.resolve(comment.id);
    expect(resolvedComment.resolved).toBe(true);
  });

  it("is a plain comment unless it asks for a change", async () => {
    const db = await makeDbWithProject();
    const model = new CommentModel(db);
    const plain = await model.create(mockProject.id, "b1", "u", { body: "x" });
    const request = await model.create(mockProject.id, "b1", "u", {
      body: "fix this",
      kind: "change_request",
    });
    expect([plain.kind, request.kind]).toEqual(["comment", "change_request"]);
    expect([request.resolved, request.resolvedAt, request.resolvedBy]).toEqual([false, null, null]);
    expect((await model.get(request.id))?.kind).toBe("change_request");
    expect(await model.get("nope")).toBeNull();
  });

  it("records who resolved a comment and when, and clears both on reopen", async () => {
    const db = await makeDbWithProject();
    const model = new CommentModel(db);
    const request = await model.create(mockProject.id, "b1", "u", {
      body: "fix this",
      kind: "change_request",
    });
    const resolved = await model.resolve(request.id, "dev-1");
    expect(resolved).toMatchObject({ resolved: true, resolvedBy: "dev-1", kind: "change_request" });
    expect(resolved.resolvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    const anonymous = await model.resolve(request.id);
    expect(anonymous.resolvedBy).toBeNull();
    const reopened = await model.reopen(request.id);
    expect([reopened.resolved, reopened.resolvedAt, reopened.resolvedBy]).toEqual([
      false,
      null,
      null,
    ]);
    expect(reopened.kind).toBe("change_request");
  });

  it("anchors to a build, a story or a snapshot, never two", async () => {
    const db = await makeDbWithProject();
    const model = new CommentModel(db);
    const onBuild = await model.create(mockProject.id, "b1", "u", { body: "x" });
    const onStory = await model.create(mockProject.id, "b1", "u", { body: "x", storyId: "a--b" });
    const onSnapshot = await model.create(mockProject.id, "b1", "u", {
      body: "x",
      snapshotId: "s1",
    });
    expect([onBuild, onStory, onSnapshot].map((c) => [c.snapshotId, c.storyId])).toEqual([
      [null, null],
      [null, "a--b"],
      ["s1", null],
    ]);
    await expect(
      model.create(mockProject.id, "b1", "u", { body: "x", storyId: "a--b", snapshotId: "s1" }),
    ).rejects.toThrow("not several");
  });
  describe("mentions", () => {
    it("stores resolved mentions as ids with the handle as typed, and reads them back", async () => {
      const model = await modelOf();
      const comment = await model.create(mockProject.id, "b1", "u1", {
        body: "cc @alex.doe and @Sam Lee",
        mentions: [
          { userId: "u2", handle: "alex.doe" },
          { userId: "u3", handle: "Sam Lee" },
        ],
      });
      expect(CommentModel.mentionsOf(comment)).toEqual([
        { userId: "u2", handle: "alex.doe" },
        { userId: "u3", handle: "Sam Lee" },
      ]);
      const [listed] = await model.listByBuild("b1");
      expect(CommentModel.mentionsOf(listed as never)).toHaveLength(2);
    });

    it("stores null, not an empty list, when nobody is mentioned", async () => {
      const model = await modelOf();
      const none = await model.create(mockProject.id, "b1", "u1", { body: "plain" });
      const empty = await model.create(mockProject.id, "b1", "u1", { body: "x", mentions: [] });
      expect(none.mentions).toBeNull();
      expect(empty.mentions).toBeNull();
      expect(CommentModel.mentionsOf(none)).toEqual([]);
    });

    it("drops what is not a mention instead of throwing on a hand-edited or older row", () => {
      expect(CommentModel.mentionsOf({ mentions: undefined })).toEqual([]);
      expect(CommentModel.mentionsOf({ mentions: "not json" })).toEqual([]);
      expect(CommentModel.mentionsOf({ mentions: '{"userId":"u"}' })).toEqual([]);
      expect(
        CommentModel.mentionsOf({
          mentions: '[{"userId":"u2","handle":"a"},{"userId":3},"x",null,{"userId":"u4"}]',
        }),
      ).toEqual([{ userId: "u2", handle: "a" }]);
    });
  });
});
