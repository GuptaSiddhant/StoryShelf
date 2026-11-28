/** `SnapshotModel.latestEarlierOnBranch` on node:sqlite: the real SQL, and the index that serves it. */
import { createShelfLogger } from "@storyshelf/core/logger";
import { ProjectModel, SnapshotModel } from "@storyshelf/core/models";
import { expect, it } from "vitest";
import { createSqliteDatabase } from "./index.ts";

const silent = createShelfLogger({ level: "silent" });
const day = (n: number): string => `2026-01-0${n}T00:00:00.000Z`;

it("finds the newest earlier snapshot on the branch in one statement", async () => {
  const db = createSqliteDatabase(":memory:");
  await db.lifecycle?.setup({ config: {}, logger: silent });
  const project = await new ProjectModel(db).create({ name: "P", slug: "p" } as never);
  const build = async (id: string, branch: string, status: string, n: number) =>
    await db.insert(db.tables.builds, {
      id,
      projectId: project.id,
      gitSha: "sha",
      gitBranch: branch,
      status,
      createdAt: day(n),
      updatedAt: day(n),
    } as never);
  await build("b1", "x", "approved", 1);
  await build("b2", "x", "failed", 2);
  await build("b3", "y", "approved", 3);
  const model = new SnapshotModel(db);
  const input = {
    storyId: "s",
    storyName: "S",
    storyTitle: "T",
    viewportName: "desktop",
    viewportWidth: 1,
    viewportHeight: 1,
    screenshotPath: "/s.png",
  };
  const wanted = await model.create(project.id, "b1", input);
  await model.create(project.id, "b2", input);
  await model.create(project.id, "b3", input);
  const selected = {
    projectId: project.id,
    storyId: "s",
    viewportName: "desktop",
    browser: "chromium",
  };
  expect((await model.latestEarlierOnBranch(selected, "x", day(5)))?.id).toBe(wanted.id);
  expect(await model.latestEarlierOnBranch(selected, "x", day(1))).toBeNull();
  expect(
    await model.latestEarlierOnBranch({ ...selected, storyId: "new" }, "x", day(5)),
  ).toBeNull();
});
