import { createShelfLogger } from "@storyshelf/core/logger";
/** `builds.review_cycle` and the once-per-cycle claim of a review request, on node:sqlite. */
import { BuildModel } from "@storyshelf/core/models";
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
    gitBranch: "feature/x",
    createdAt: T0,
    updatedAt: T0,
  } as never);
  return { db, builds: new BuildModel(db) };
}

it("starts a build in cycle 0 with nothing requested", async () => {
  const { db } = await seeded();
  expect(await db.get(db.tables.builds, "b1")).toMatchObject({
    reviewCycle: 0,
    reviewRequestedCycle: null,
  });
});

it("lets one caller claim a cycle, however many ask and however often", async () => {
  const { builds } = await seeded();
  const claims = await Promise.all(
    Array.from({ length: 5 }, async () => await builds.claimReviewRequest("b1")),
  );
  expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
  expect(claims.find((claim) => claim !== null)).toMatchObject({ reviewCycle: 0 });
  expect(await builds.claimReviewRequest("b1")).toBeNull();
});

it("claims nothing for a build that is not pending", async () => {
  const { builds } = await seeded();
  await builds.setStatus("b1", "failed");
  expect(await builds.claimReviewRequest("b1")).toBeNull();
  await builds.setStatus("b1", "approved");
  expect(await builds.claimReviewRequest("b1")).toBeNull();
});

it("starts a new cycle when a verdict build goes back to pending, once per reopening", async () => {
  const { db, builds } = await seeded();
  await builds.claimReviewRequest("b1");
  await builds.setStatus("b1", "approved");
  expect((await builds.setStatus("b1", "pending")).reviewCycle).toBe(1);
  // Writing `pending` again is not a reopening.
  expect((await builds.setStatus("b1", "pending")).reviewCycle).toBe(1);
  expect(await builds.claimReviewRequest("b1")).toMatchObject({ reviewCycle: 1 });
  expect(await builds.claimReviewRequest("b1")).toBeNull();
  await builds.setStatus("b1", "rejected");
  await builds.setStatus("b1", "pending");
  expect(await db.get(db.tables.builds, "b1")).toMatchObject({
    reviewCycle: 2,
    reviewRequestedCycle: 1,
  });
  expect(await builds.claimReviewRequest("b1")).toMatchObject({ reviewCycle: 2 });
});

it("counts concurrent reopenings of one build once", async () => {
  const { builds } = await seeded();
  await builds.setStatus("b1", "approved");
  const moved = await Promise.all([
    builds.setStatus("b1", "pending"),
    builds.setStatus("b1", "pending"),
  ]);
  expect(moved.map((build) => build.status)).toEqual(["pending", "pending"]);
  expect((await builds.setStatus("b1", "pending")).reviewCycle).toBe(1);
});

it("does not count a retry from failed or cancelled as a reopening", async () => {
  const { builds } = await seeded();
  await builds.setStatus("b1", "failed");
  expect(await builds.resetStatus("b1", "pending")).toMatchObject({
    status: "pending",
    reviewCycle: 0,
  });
  await builds.resetStatus("b1", "cancelled");
  expect(await builds.resetStatus("b1", "pending")).toMatchObject({
    status: "pending",
    reviewCycle: 0,
  });
});
