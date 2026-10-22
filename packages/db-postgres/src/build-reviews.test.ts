import { createShelfLogger } from "@storyshelf/core/logger";
/** `build_reviews`, `projects.review_*` and `comments.story_id` on embedded Postgres (PGlite). */
import { BuildReviewModel, CommentModel, ProjectModel } from "@storyshelf/core/models";
import { expect, it, vi } from "vitest";
import { createPgliteDatabase } from "./pglite.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const silent = createShelfLogger({ level: "silent" });
const T0 = "2026-01-01T00:00:00.000Z";

async function seeded() {
  const db = createPgliteDatabase();
  await db.lifecycle?.setup({ config: {}, logger: silent });
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "P",
    slug: "p",
    gitDefaultBranch: "main",
    createdAt: T0,
    updatedAt: T0,
  } as never);
  await Promise.all(
    ["b1", "b2"].map(
      async (id) =>
        await db.insert(db.tables.builds, {
          id,
          projectId: "p1",
          gitSha: id,
          gitBranch: "feature/x",
          createdAt: T0,
          updatedAt: T0,
        } as never),
    ),
  );
  await db.insert(db.tables.users, {
    id: "u1",
    email: "u1@example.com",
    name: "U1",
    role: "member",
    createdAt: T0,
  } as never);
  return db;
}

it("defaults a project to review on with one required approval", async () => {
  const project = await new ProjectModel(await seeded()).get("p1");
  expect(project).toMatchObject({ reviewEnabled: true, reviewApprovals: 1 });
});

it("stores the review switch and the required approvals", async () => {
  const projects = new ProjectModel(await seeded());
  const updated = await projects.update("p1", { reviewEnabled: false, reviewApprovals: 3 });
  expect(updated).toMatchObject({ reviewEnabled: false, reviewApprovals: 3 });
  expect(await projects.get("p1")).toMatchObject({ reviewEnabled: false, reviewApprovals: 3 });
});

it("keeps the signed Storybook URL lifetime null until a project sets one", async () => {
  const projects = new ProjectModel(await seeded());
  expect((await projects.get("p1"))?.storybookUrlTtlSeconds ?? null).toBeNull();
  await projects.update("p1", { storybookUrlTtlSeconds: 14_400 });
  expect((await projects.get("p1"))?.storybookUrlTtlSeconds).toBe(14_400);
  await projects.update("p1", { storybookUrlTtlSeconds: null });
  expect((await projects.get("p1"))?.storybookUrlTtlSeconds ?? null).toBeNull();
});

it("round-trips a story-anchored comment", async () => {
  const comments = new CommentModel(await seeded());
  const story = await comments.create("p1", "b1", "u1", { body: "hi", storyId: "a--x" });
  const build = await comments.create("p1", "b1", "u1", { body: "hello" });
  const rows = await comments.listByBuild("b1");
  expect(rows.find((row) => row.id === story.id)).toMatchObject({
    storyId: "a--x",
    snapshotId: null,
  });
  expect(rows.find((row) => row.id === build.id)).toMatchObject({ storyId: null });
});

it("stores verdicts, keeps each reviewer's latest, and allows a verdict without a user", async () => {
  const reviews = new BuildReviewModel(await seeded());
  await reviews.add("b1", "u1", "rejected", "no");
  await reviews.add("b1", "u1", "approved");
  await reviews.add("b1", null, "approved");
  await reviews.add("b2", "u1", "rejected");
  expect(await reviews.listByBuild("b1")).toHaveLength(3);
  const latest = await reviews.latestByBuild("b1");
  expect(latest.map((row) => row.verdict)).toEqual(["approved", "approved"]);
});

it("drops a build's verdicts with the build and a user's with the user (ON DELETE CASCADE)", async () => {
  const db = await seeded();
  const reviews = new BuildReviewModel(db);
  await reviews.add("b1", "u1", "approved");
  await reviews.add("b2", "u1", "approved");
  await db.remove(db.tables.builds, "b1");
  expect(await reviews.listByBuild("b1")).toEqual([]);
  expect(await reviews.listByBuild("b2")).toHaveLength(1);
  await db.remove(db.tables.users, "u1");
  expect(await reviews.listByBuild("b2")).toEqual([]);
});
