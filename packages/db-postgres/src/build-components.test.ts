import { createShelfLogger } from "@storyshelf/core/logger";
/** `build_components` on embedded Postgres (PGlite): the model over the real table, and the foreign-key cascade. */
import { BuildComponentModel } from "@storyshelf/core/models";
import { expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });
import { createPgliteDatabase } from "./pglite.ts";

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
          gitBranch: "main",
          createdAt: T0,
          updatedAt: T0,
        } as never),
    ),
  );
  return db;
}

const button = { importPath: "src/Button.stories.tsx", title: "Button", storyCount: 2, hash: "h1" };

it("stores, lists and replaces a build's component rows", async () => {
  const model = new BuildComponentModel(await seeded());
  await model.replaceForBuild("p1", "b1", [button]);
  await model.replaceForBuild("p1", "b2", [
    button,
    { ...button, importPath: "src/B.tsx", title: "B" },
  ]);
  await model.replaceForBuild("p1", "b1", [{ ...button, hash: "h2" }]);
  expect((await model.listByBuild("b1")).map((row) => row.hash)).toEqual(["h2"]);
  expect(await model.listByBuild("b2")).toHaveLength(2);
  const history = await model.listByImportPath("p1", button.importPath);
  expect(history.map((row) => row.buildId).toSorted()).toEqual(["b1", "b2"]);
  await model.removeForBuild("b2");
  expect(await model.listByBuild("b2")).toEqual([]);
});

it("drops a build's rows with the build (ON DELETE CASCADE)", async () => {
  const db = await seeded();
  const model = new BuildComponentModel(db);
  await model.replaceForBuild("p1", "b1", [button]);
  await model.replaceForBuild("p1", "b2", [button]);
  await db.remove(db.tables.builds, "b1");
  expect(await model.listByBuild("b1")).toEqual([]);
  expect(await model.listByBuild("b2")).toHaveLength(1);
});
