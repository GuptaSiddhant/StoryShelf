import { createShelfLogger } from "@storyshelf/core/logger";
/** `comments.mentions` round trip on node:sqlite. */
import { CommentModel } from "@storyshelf/core/models";
import { expect, it } from "vite-plus/test";
import { createSqliteDatabase } from "./index.ts";

const silent = createShelfLogger({ level: "silent" });
const T0 = "2026-01-01T00:00:00.000Z";

async function seeded() {
  const db = createSqliteDatabase(":memory:");
  await db.lifecycle?.setup({ config: {}, logger: silent });
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "P",
    slug: "p",
    gitDefaultBranch: "main",
    createdAt: T0,
    updatedAt: T0,
  } as never);
  await db.insert(db.tables.builds, {
    id: "b1",
    projectId: "p1",
    gitSha: "b1",
    gitBranch: "main",
    createdAt: T0,
    updatedAt: T0,
  } as never);
  return { db, comments: new CommentModel(db) };
}

it("persists mentions as JSON ids and reads them back", async () => {
  const { comments } = await seeded();
  await comments.create("p1", "b1", null, {
    body: "hi @alex",
    mentions: [{ userId: "u2", handle: "alex" }],
  });
  const [row] = await comments.listByBuild("b1");
  expect(row?.mentions).toBe('[{"userId":"u2","handle":"alex"}]');
  expect(CommentModel.mentionsOf(row as never)).toEqual([{ userId: "u2", handle: "alex" }]);
});

it("leaves mentions null for a comment that mentions nobody", async () => {
  const { comments } = await seeded();
  await comments.create("p1", "b1", null, { body: "plain" });
  const [row] = await comments.listByBuild("b1");
  expect(row?.mentions).toBeNull();
});
