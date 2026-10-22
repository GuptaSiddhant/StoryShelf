import { describe, expect, it } from "vitest";
import { BuildReviewModel } from "../models/build-review.ts";
import { CommentModel } from "../models/comment.ts";
import { createTestBuild, createTestProject } from "../test-helpers/create-project.ts";
import { makeDatabase, makeStorage } from "../test-helpers/fake-adapters.ts";
import { pendingCandidates } from "./pending.ts";
import { Retention } from "./purge.ts";

const DAY = 86_400_000;
const OLD = new Date(Date.now() - 60 * DAY).toISOString();
const RECENT = new Date(Date.now() - 1 * DAY).toISOString();
const CUTOFF = new Date(Date.now() - 30 * DAY).toISOString();

async function setup() {
  const { db } = makeDatabase();
  const project = await createTestProject(db, db.tables);
  const build = async (
    gitBranch: string,
    createdAt: string,
    patch: Record<string, unknown> = {},
  ): Promise<string> => {
    const created = await createTestBuild(db, db.tables, project.id, {
      gitBranch,
      gitSha: `${gitBranch}-${createdAt}`,
    });
    await db.update(db.tables.builds, created.id, { createdAt, updatedAt: createdAt, ...patch });
    return created.id;
  };
  return { db, project, build };
}

describe("pendingCandidates", () => {
  it("marks an idle pending build past the window, and a superseded one as such", async () => {
    const { db, project, build } = await setup();
    const superseded = await build("feat", OLD);
    const latest = await build("feat", new Date(Date.now() - 40 * DAY).toISOString());
    const found = await pendingCandidates(db, project.id, CUTOFF);
    expect(found).toEqual(
      expect.arrayContaining([
        { buildId: superseded, reason: "superseded" },
        { buildId: latest, reason: "idle" },
      ]),
    );
    expect(found).toHaveLength(2);
  });

  it("keeps recent builds, and builds on other branches never supersede", async () => {
    const { db, project, build } = await setup();
    const old = await build("feat", OLD);
    await build("other", RECENT);
    await build("feat-2", RECENT);
    const found = await pendingCandidates(db, project.id, CUTOFF);
    expect(found).toEqual([{ buildId: old, reason: "idle" }]);
  });

  it("measures a reviewed build from its last comment or verdict", async () => {
    const { db, project, build } = await setup();
    const commented = await build("a", OLD);
    const verdict = await build("b", OLD);
    const quiet = await build("c", OLD);
    await new CommentModel(db).create(project.id, commented, null, { body: "ping" });
    await new BuildReviewModel(db).add(verdict, null, "approved");
    const found = await pendingCandidates(db, project.id, CUTOFF);
    expect(found.map((candidate) => candidate.buildId)).toEqual([quiet]);
  });

  it("never lists builds that are not pending", async () => {
    const { db, project, build } = await setup();
    await build("a", OLD, { status: "approved" });
    await build("b", OLD, { status: "reviewing" });
    expect(await pendingCandidates(db, project.id, CUTOFF)).toEqual([]);
  });
});

const tables = (db: ReturnType<typeof makeDatabase>["db"]) => ({
  builds: db.tables.builds,
  buildLabels: db.tables.buildLabels,
  baselines: db.tables.baselines,
});

describe("Retention of pending builds", () => {
  it("purges idle pending builds, including the latest of a branch, and their comments", async () => {
    const { db, project, build } = await setup();
    const stale = await build("feat", OLD);
    const fresh = await build("fresh", RECENT);
    const { storage } = makeStorage();
    const result = await new Retention(db, storage, tables(db)).purge(project, {
      ttlDays: 30,
      keepLatestPerBranch: true,
    });
    expect(result.removedBuilds).toBe(1);
    expect(await db.get(db.tables.builds, stale)).toBeNull();
    expect(await db.get(db.tables.builds, fresh)).not.toBeNull();
  });

  it("keeps a pending build that someone commented on recently", async () => {
    const { db, project, build } = await setup();
    const id = await build("feat", OLD);
    await new CommentModel(db).create(project.id, id, null, { body: "still looking" });
    const { storage } = makeStorage();
    const result = await new Retention(db, storage, tables(db)).purge(project, {
      ttlDays: 30,
      keepLatestPerBranch: false,
    });
    expect(result.removedBuilds).toBe(0);
  });
});
