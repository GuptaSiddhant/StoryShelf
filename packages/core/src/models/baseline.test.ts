import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { makeDatabase, makeStorage } from "../test-helpers/fake-adapters.ts";
import { baselinePath, contentPath } from "../utils/paths.ts";
import { BaselineModel } from "./baseline.ts";

const PNG = Buffer.from([137, 80, 78, 71]);
const contentOf = (data: Buffer, project = "p1"): string =>
  contentPath(project, createHash("sha256").update(data).digest("hex"));

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
    const model = new BaselineModel(db, { baselines: db.tables.baselines }, storage);
    await expect(model.getFor("p1", "story", "desktop", "main")).resolves.toBeNull();
  });

  it("resolves the branch-specific baseline over the default", async () => {
    const { db, storage } = setup();
    const model = new BaselineModel(db, { baselines: db.tables.baselines }, storage);
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
    const model = new BaselineModel(db, { baselines: db.tables.baselines }, storage);
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
    const model = new BaselineModel(db, { baselines: db.tables.baselines }, storage);
    await expect(model.resolve("p1", "story", "desktop", "feature", "main")).resolves.toBeNull();
  });

  it("upsert creates then updates the same branch baseline", async () => {
    const { db, storage } = setup();
    const model = new BaselineModel(db, { baselines: db.tables.baselines }, storage);
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
    expect(created.screenshotPath).toBe(contentOf(PNG));

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
    // The baseline is repointed at the new content; the old object stays for the retention sweep.
    expect(updated.screenshotPath).toBe(contentOf(Buffer.from([1, 2, 3])));
    await expect(model.read(updated)).resolves.toEqual(Buffer.from([1, 2, 3]));
    await expect(storage.exists(contentOf(PNG))).resolves.toBe(true);
  });

  it("claims content while storing a legacy source, and not for a content source", async () => {
    const { db, storage } = setup();
    const model = new BaselineModel(db, { baselines: db.tables.baselines }, storage);
    await storage.write("source/shot.png", PNG);
    const writes: string[] = [];
    const write = storage.write.bind(storage);
    storage.write = async (path, data) => {
      writes.push(path);
      await write(path, data);
    };
    await model.upsert("p1", "story", "desktop", "main", "snap-1", "source/shot.png");
    expect(writes[0]).toMatch(/^p1\/content\/\.claims\/.+\.json$/u);
    await expect(storage.exists(writes[0] ?? "")).resolves.toBe(false);

    writes.length = 0;
    await model.upsert("p1", "story", "desktop", "main", "snap-2", contentOf(PNG));
    expect(writes).toEqual([]);
  });

  it("keeps one baseline per engine for the same story and mode", async () => {
    const { db, storage } = setup();
    const model = new BaselineModel(db, { baselines: db.tables.baselines }, storage);
    await storage.write("source/shot.png", PNG);
    const chromium = await model.upsert("p1", "s", "dark", "main", "snap-1", "source/shot.png");
    const firefox = await model.upsert(
      "p1",
      "s",
      "dark",
      "main",
      "snap-2",
      "source/shot.png",
      null,
      {
        browser: "firefox",
        mode: '{"theme":"dark"}',
      },
    );
    expect(firefox.id).not.toBe(chromium.id);
    // Identical bytes are one object, however many baselines use them.
    expect(chromium.screenshotPath).toBe(contentOf(PNG));
    expect(firefox.screenshotPath).toBe(chromium.screenshotPath);
    expect((await model.getFor("p1", "s", "dark", "main"))?.id).toBe(chromium.id);
    expect((await model.getFor("p1", "s", "dark", "main", "firefox"))?.id).toBe(firefox.id);
    expect((await model.resolve("p1", "s", "dark", "feat", "main", "firefox"))?.id).toBe(
      firefox.id,
    );
    await expect(model.getFor("p1", "s", "dark", "main", "webkit")).resolves.toBeNull();
    const updated = await model.upsert(
      "p1",
      "s",
      "dark",
      "main",
      "snap-3",
      "source/shot.png",
      null,
      {
        browser: "firefox",
      },
    );
    expect(updated.id).toBe(firefox.id);
    expect(updated.mode).toBe('{"theme":"dark"}');
  });

  it("lists baselines scoped to the project", async () => {
    const { db, storage } = setup();
    const model = new BaselineModel(db, { baselines: db.tables.baselines }, storage);
    await seedBaseline(model, storage);
    await seedBaseline(model, storage, { storyId: "other", branch: "feature" });
    const listed = await model.list("p1");
    expect(listed).toHaveLength(2);
    await expect(model.list("p2")).resolves.toHaveLength(0);
  });

  it("removeOrphans deletes baselines for unknown stories", async () => {
    const { db, storage } = setup();
    const model = new BaselineModel(db, { baselines: db.tables.baselines }, storage);
    await seedBaseline(model, storage);
    await seedBaseline(model, storage, { storyId: "gone" });
    const removed = await model.removeOrphans("p1", new Set(["components-button--primary"]));
    expect(removed).toBe(1);
    const listed = await model.list("p1");
    expect(listed.map((b) => b.storyId)).toEqual(["components-button--primary"]);
  });

  it("removeOrphans leaves a shared content object for the sweep", async () => {
    const { db, storage } = setup();
    const model = new BaselineModel(db, { baselines: db.tables.baselines }, storage);
    await seedBaseline(model, storage, { storyId: "gone" });
    await seedBaseline(model, storage, { storyId: "keep" });
    await model.removeOrphans("p1", new Set(["keep"]));
    await expect(model.list("p1")).resolves.toHaveLength(1);
    // "keep" still points at the same bytes, so the object must survive.
    await expect(storage.exists(contentOf(PNG))).resolves.toBe(true);
  });

  it("removeOrphans still deletes a legacy per-baseline file", async () => {
    const { db, storage } = setup();
    const model = new BaselineModel(db, { baselines: db.tables.baselines }, storage);
    const legacy = baselinePath("p1", "main", "gone", "desktop");
    await storage.write(legacy, PNG);
    await db.insert(db.tables.baselines, {
      id: "legacy",
      projectId: "p1",
      storyId: "gone",
      viewportName: "desktop",
      branch: "main",
      snapshotId: null,
      screenshotPath: legacy,
      browser: "chromium",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await model.removeOrphans("p1", new Set(["keep"]));
    await expect(storage.exists(legacy)).resolves.toBe(false);
    await expect(model.list("p1")).resolves.toHaveLength(0);
  });

  it("removeForBranch removes only that branch's rows and keeps shared content", async () => {
    const { db, storage } = setup();
    const model = new BaselineModel(db, { baselines: db.tables.baselines }, storage);
    await seedBaseline(model, storage, { branch: "feature", storyId: "s1" });
    await seedBaseline(model, storage, { branch: "main", storyId: "s1" });
    const removed = await model.removeForBranch("p1", "feature");
    expect(removed).toBe(1);
    const remaining = await model.list("p1");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.branch).toBe("main");
    await expect(storage.exists(remaining[0]?.screenshotPath ?? "")).resolves.toBe(true);
  });

  it("removeStaleBranches deletes multiple branches", async () => {
    const { db, storage } = setup();
    const model = new BaselineModel(db, { baselines: db.tables.baselines }, storage);
    await seedBaseline(model, storage, { branch: "stale-1", storyId: "s1" });
    await seedBaseline(model, storage, { branch: "stale-2", storyId: "s1" });
    await seedBaseline(model, storage, { branch: "fresh", storyId: "s1" });
    const removed = await model.removeStaleBranches("p1", new Set(["stale-1", "stale-2"]));
    expect(removed).toBe(2);
    const remaining = await model.list("p1");
    expect(remaining.map((b) => b.branch)).toEqual(["fresh"]);
  });

  describe("rebase- and squash-proof lookup (no git ancestry)", () => {
    it("keeps no commit reference in the baseline row or resolve() signature", async () => {
      const { db, storage } = setup();
      const model = new BaselineModel(db, { baselines: db.tables.baselines }, storage);
      const { id } = await seedBaseline(model, storage, { branch: "feature/x" });
      const row = (await model.list("p1")).find((b) => b.id === id) as unknown as Record<
        string,
        unknown
      >;
      expect(Object.keys(row).filter((k) => /sha|commit|parent|ancest/iu.test(k))).toEqual([]);
      // Key lookup only: (project, story, viewport, branch, defaultBranch[, browser]).
      expect(model.resolve.length).toBeLessThanOrEqual(6);
    });

    it("resolves the branch baseline for later builds regardless of their sha (rebase)", async () => {
      const { db, storage } = setup();
      const model = new BaselineModel(db, { baselines: db.tables.baselines }, storage);
      const { id } = await seedBaseline(model, storage, { branch: "feature/x" });
      // Builds at sha A, a rebased sha B, then sha C: resolve() receives no sha,
      // so every call returns the same accepted baseline.
      const resolved = await Promise.all(
        [0, 1, 2].map(() =>
          model.resolve("p1", "components-button--primary", "desktop", "feature/x", "main"),
        ),
      );
      expect(resolved.map((b) => b?.id)).toEqual([id, id, id]);
    });

    it("squash-merge promotes via the default branch with an unrelated sha", async () => {
      const { db, storage } = setup();
      const model = new BaselineModel(db, { baselines: db.tables.baselines }, storage);
      const story = "components-button--primary";
      await seedBaseline(model, storage, { branch: "feature/x" });
      await expect(model.resolve("p1", story, "desktop", "feature/y", "main")).resolves.toBeNull();
      // The squash commit on main shares no ancestry with feature/x's commits:
      // the default-branch build just upserts under (project, story, viewport, main).
      await storage.write("source/squash.png", PNG);
      const promoted = await model.upsert(
        "p1",
        story,
        "desktop",
        "main",
        "snap-squash",
        "source/squash.png",
      );
      const other = await model.resolve("p1", story, "desktop", "feature/y", "main");
      expect(other?.id).toBe(promoted.id);
      expect(other?.branch).toBe("main");
    });
  });
});
