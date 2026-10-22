/** `projects.run_a11y` (on by default) and `snapshots.a11y_violations` on embedded Postgres (PGlite). */
import { createShelfLogger } from "@storyshelf/core/logger";
import { ProjectModel, SnapshotModel } from "@storyshelf/core/models";
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
  await db.insert(db.tables.builds, {
    id: "b1",
    projectId: "p1",
    gitSha: "b1",
    gitBranch: "main",
    createdAt: T0,
    updatedAt: T0,
  } as never);
  return db;
}

it("turns accessibility checks on for a new project and lets an admin turn them off", async () => {
  const projects = new ProjectModel(await seeded());
  expect((await projects.get("p1"))?.runA11y).toBe(true);
  expect((await projects.update("p1", { runA11y: false })).runA11y).toBe(false);
});

it("stores the axe violations of a snapshot as text", async () => {
  const db = await seeded();
  const texts = JSON.stringify(["image-alt (critical): Images must have alternative text"]);
  const snapshot = await new SnapshotModel(db).create("p1", "b1", {
    storyId: "s",
    storyName: "S",
    storyTitle: "T",
    viewportName: "desktop",
    viewportWidth: 1,
    viewportHeight: 1,
    screenshotPath: "x.png",
    a11yViolations: texts,
  });
  expect(snapshot.a11yViolations).toBe(texts);
});
