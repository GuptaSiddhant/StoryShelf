import { describe, expect, it } from "vitest";
import { makeDatabase, makeStorage } from "../test-helpers/fake-adapters.ts";
import { baselinePath } from "../utils/paths.ts";
import { BaselineModel } from "./baseline.ts";

const PNG = Buffer.from([137, 80, 78, 71]);

function setup(): {
  db: ReturnType<typeof makeDatabase>["db"];
  storage: ReturnType<typeof makeStorage>["storage"];
} {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  return { db, storage };
}

async function seedBaseline(
  model: BaselineModel,
  storage: ReturnType<typeof makeStorage>["storage"],
  overrides: { branch?: string; storyId?: string } = {},
): Promise<{ id: string }> {
  const branch = overrides.branch ?? "main";
  const storyId = overrides.storyId ?? "components-button--primary";
  await storage.write("source/shot.png", PNG);
  const baseline = await model.upsert(
    "p1",
    storyId,
    "desktop",
    branch,
    "snap-1",
    "source/shot.png",
  );
  return { id: baseline.id };
}

describe("BaselineModel", () => {
  it("returns null from getFor when no baseline exists", async () => {
    const { db, storage } = setup();
    const model = new BaselineModel(db, storage);
    await expect(model.getFor("p1", "story", "desktop", "main")).resolves.toBeNull();
  });

  it("resolves the branch-specific baseline over the default", async () => {
    const { db, storage } = setup();
    const model = new BaselineModel(db, storage);
    await storage.write("source/shot.png", PNG);
    const main = await model.upsert(
      "p1",
      "story",
      "desktop",
      "main",
      "snap-main",
      "source/shot.png",
    );
    const feature = await model.upsert(
      "p1",
      "story",
      "desktop",
      "feature",
      "snap-feature",
      "source/shot.png",
    );
    const resolved = await model.resolve("p1", "story", "desktop", "feature", "main");
    expect(resolved?.id).toBe(feature.id);
    expect(main.id).toBeDefined();
  });

  it("falls back to the default branch baseline", async () => {
    const { db, storage } = setup();
    const model = new BaselineModel(db, storage);
    const { id } = await seedBaseline(model, storage);
    const resolved = await model.resolve(
      "p1",
      "components-button--primary",
      "desktop",
      "feature",
      "main",
    );
    expect(resolved?.id).toBe(id);
  });

  it("resolves null when neither branch has a baseline", async () => {
    const { db, storage } = setup();
    const model = new BaselineModel(db, storage);
    await expect(model.resolve("p1", "story", "desktop", "feature", "main")).resolves.toBeNull();
  });

  it("upsert creates then updates the same branch baseline", async () => {
    const { db, storage } = setup();
    const model = new BaselineModel(db, storage);
    await storage.write("source/shot.png", PNG);
    const created = await model.upsert(
      "p1",
      "story",
      "desktop",
      "main",
      "snap-1",
      "source/shot.png",
    );
    expect(created.snapshotId).toBe("snap-1");
    expect(created.screenshotPath).toBe(baselinePath("p1", "main", "story", "desktop"));

    await storage.write("source/shot2.png", Buffer.from([1, 2, 3]));
    const updated = await model.upsert(
      "p1",
      "story",
      "desktop",
      "main",
      "snap-2",
      "source/shot2.png",
    );
    expect(updated.id).toBe(created.id);
    expect(updated.snapshotId).toBe("snap-2");
    await expect(model.read(updated)).resolves.toEqual(Buffer.from([1, 2, 3]));
  });

  it("lists baselines scoped to the project", async () => {
    const { db, storage } = setup();
    const model = new BaselineModel(db, storage);
    await seedBaseline(model, storage);
    await seedBaseline(model, storage, { storyId: "other", branch: "feature" });
    const listed = await model.list("p1");
    expect(listed).toHaveLength(2);
    await expect(model.list("p2")).resolves.toHaveLength(0);
  });

  it("removeOrphans deletes baselines for unknown stories", async () => {
    const { db, storage } = setup();
    const model = new BaselineModel(db, storage);
    await seedBaseline(model, storage);
    await seedBaseline(model, storage, { storyId: "gone" });
    const removed = await model.removeOrphans("p1", new Set(["components-button--primary"]));
    expect(removed).toBe(1);
    const listed = await model.list("p1");
    expect(listed.map((b) => b.storyId)).toEqual(["components-button--primary"]);
  });

  it("removeOrphans also deletes the storage object", async () => {
    const { db, storage } = setup();
    const model = new BaselineModel(db, storage);
    await seedBaseline(model, storage, { storyId: "gone" });
    const gonePath = baselinePath("p1", "main", "gone", "desktop");
    await expect(storage.exists(gonePath)).resolves.toBe(true);
    await model.removeOrphans("p1", new Set(["keep"]));
    await expect(storage.exists(gonePath)).resolves.toBe(false);
    await expect(model.list("p1")).resolves.toHaveLength(0);
  });

  it("removeForBranch deletes only that branch", async () => {
    const { db, storage } = setup();
    const model = new BaselineModel(db, storage);
    await seedBaseline(model, storage, { branch: "feature", storyId: "s1" });
    await seedBaseline(model, storage, { branch: "main", storyId: "s1" });
    const featurePath = baselinePath("p1", "feature", "s1", "desktop");
    await expect(storage.exists(featurePath)).resolves.toBe(true);
    const removed = await model.removeForBranch("p1", "feature");
    expect(removed).toBe(1);
    await expect(storage.exists(featurePath)).resolves.toBe(false);
    const remaining = await model.list("p1");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.branch).toBe("main");
  });

  it("removeStaleBranches deletes multiple branches", async () => {
    const { db, storage } = setup();
    const model = new BaselineModel(db, storage);
    await seedBaseline(model, storage, { branch: "stale-1", storyId: "s1" });
    await seedBaseline(model, storage, { branch: "stale-2", storyId: "s1" });
    await seedBaseline(model, storage, { branch: "fresh", storyId: "s1" });
    const removed = await model.removeStaleBranches("p1", new Set(["stale-1", "stale-2"]));
    expect(removed).toBe(2);
    const remaining = await model.list("p1");
    expect(remaining.map((b) => b.branch)).toEqual(["fresh"]);
  });
});
