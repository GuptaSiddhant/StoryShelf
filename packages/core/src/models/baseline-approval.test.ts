import { describe, expect, it } from "vitest";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { Baseline } from "../schema/baseline.ts";
import type { Build } from "../schema/build.ts";
import type { Project } from "../schema/project.ts";
import type { Snapshot } from "../schema/snapshot.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import {
  approveInTransaction,
  BaselineApprovalConflict,
  type AtomicBaselineApproval,
} from "./baseline-approval.ts";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";

const project = {
  id: "p",
  name: "Project",
  slug: "p",
  gitDefaultBranch: "main",
  createdAt: T1,
  updatedAt: T1,
} as Project;

const build = {
  id: "b",
  projectId: "p",
  gitBranch: "feature",
  status: "reviewing",
  createdAt: T1,
  updatedAt: T1,
} as Build;

const snapshot = {
  id: "s",
  projectId: "p",
  buildId: "b",
  storyId: "story",
  viewportName: "desktop",
  browser: "chromium",
  screenshotPath: "shot",
  status: "changed",
  baselineId: "base",
  baselineVersion: T1,
  createdAt: T1,
  updatedAt: T1,
} as Snapshot;

const baseline = {
  id: "base",
  projectId: "p",
  storyId: "story",
  viewportName: "desktop",
  browser: "chromium",
  branch: "main",
  snapshotId: "old",
  screenshotPath: "shot",
  createdAt: T1,
  updatedAt: T1,
} as Baseline;

async function setup(): Promise<DatabaseAdapter> {
  const { db } = makeDatabase();
  await db.insert(db.tables.projects, project);
  await db.insert(db.tables.builds, build);
  await db.insert(db.tables.snapshots, snapshot);
  await db.insert(db.tables.baselines, baseline);
  return db;
}

async function inputFor(db: DatabaseAdapter): Promise<AtomicBaselineApproval> {
  const current = (await db.get(db.tables.snapshots, "s")) as Snapshot | null;
  if (!current) throw new Error("Missing snapshot");
  return { snapshot: current, reviewedBy: "user", force: false, branch: "feature" };
}

async function approve(db: DatabaseAdapter, input: AtomicBaselineApproval): Promise<void> {
  if (!db.transact) throw new Error("Test database requires transactions");
  await db.transact(async (tx) => await approveInTransaction(tx, db.tables, input));
}

const snapshotMismatches: [string, (db: DatabaseAdapter) => Promise<void>][] = [
  [
    "project",
    async (db) => {
      await db.update(db.tables.snapshots, "s", { projectId: "other" });
    },
  ],
  [
    "build",
    async (db) => {
      await db.update(db.tables.snapshots, "s", { buildId: "other" });
    },
  ],
  [
    "status",
    async (db) => {
      await db.update(db.tables.snapshots, "s", { status: "approved" });
    },
  ],
  [
    "updated time",
    async (db) => {
      await db.update(db.tables.snapshots, "s", { updatedAt: T2 });
    },
  ],
  [
    "screenshot",
    async (db) => {
      await db.update(db.tables.snapshots, "s", { screenshotPath: "other" });
    },
  ],
  [
    "baseline",
    async (db) => {
      await db.update(db.tables.snapshots, "s", { baselineId: "other" });
    },
  ],
  [
    "baseline version",
    async (db) => {
      await db.update(db.tables.snapshots, "s", { baselineVersion: T2 });
    },
  ],
];

const unavailableBuilds: [string, (db: DatabaseAdapter) => Promise<void>][] = [
  [
    "missing build",
    async (db) => {
      await db.remove(db.tables.builds, "b");
    },
  ],
  [
    "missing project",
    async (db) => {
      await db.remove(db.tables.projects, "p");
    },
  ],
  [
    "mismatched build project",
    async (db) => {
      await db.update(db.tables.builds, "b", { projectId: "other" });
    },
  ],
];

describe("atomic baseline approval", () => {
  it.each(snapshotMismatches)("rejects a snapshot whose %s changed", async (_field, mutate) => {
    const db = await setup();
    const input = await inputFor(db);
    await mutate(db);
    await expect(approve(db, input)).rejects.toBeInstanceOf(BaselineApprovalConflict);
  });

  it.each(unavailableBuilds)("rejects a %s", async (_case, mutate) => {
    const db = await setup();
    const input = await inputFor(db);
    await mutate(db);
    await expect(approve(db, input)).rejects.toThrow("Build is unavailable for approval");
  });

  it("rejects a cancelled build", async () => {
    const db = await setup();
    const input = await inputFor(db);
    await db.update(db.tables.builds, "b", { status: "cancelled" });
    await expect(approve(db, input)).rejects.toThrow("Build is unavailable for approval");
  });

  it("rejects a build on a different branch", async () => {
    const db = await setup();
    const input = { ...(await inputFor(db)), branch: "other" };
    await expect(approve(db, input)).rejects.toThrow("Build is unavailable for approval");
  });

  it("approves against the default branch when the feature branch has no baseline", async () => {
    const db = await setup();
    await approve(db, await inputFor(db));
    const approved = (await db.get(db.tables.snapshots, "s")) as Snapshot;
    expect(approved.status).toBe("approved");
    expect(approved.reviewedBy).toBe("user");
    expect(approved.reviewedAt).toBeTruthy();
  });

  it("approves a status that is not waiting for review despite a stale baseline", async () => {
    const db = await setup();
    await db.update(db.tables.snapshots, "s", { status: "approved", baselineVersion: T2 });
    await approve(db, await inputFor(db));
    expect(((await db.get(db.tables.snapshots, "s")) as Snapshot).status).toBe("approved");
  });

  it("refuses a drifted baseline unless forced", async () => {
    const db = await setup();
    await db.update(db.tables.baselines, "base", { updatedAt: T2 });
    const input = await inputFor(db);
    await expect(approve(db, input)).rejects.toMatchObject({ driftStatus: "stale" });
    expect(((await db.get(db.tables.snapshots, "s")) as Snapshot).status).toBe("changed");
    await approve(db, { ...input, force: true });
    expect(((await db.get(db.tables.snapshots, "s")) as Snapshot).status).toBe("approved");
  });
});
