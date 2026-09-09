import { describe, expect, it } from "vitest";
import { baselines, buildLabels, builds } from "../../../db-sqlite/src/schema/index.ts";
import type { Project } from "../schema/project.ts";
import { makeDatabase, makeStorage } from "../test-helpers/fake-adapters.ts";
import { Retention } from "./purge.ts";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "Retention Test",
    slug: "retention-test",
    gitRepository: null,
    gitDefaultBranch: "main",
    pixelThreshold: 0.1,
    maxDiffRatio: 0.01,
    publicBranchRegex: null,
    executePlay: false,
    playTimeoutMs: 10_000,
    storybookMeta: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function retentionTables() {
  return {
    builds,
    buildLabels,
    baselines,
  };
}

async function createTestDb(
  rows: Record<string, unknown>[],
): Promise<ReturnType<typeof makeDatabase>["db"]> {
  const { db } = makeDatabase();

  await Promise.all(
    rows.map(async (row) => {
      await db.insert(builds, row as unknown as typeof builds.$inferInsert);
    }),
  );

  return db;
}

describe("Retention purge integration", () => {
  it("purges terminal builds older than TTL and keeps latest per branch", async () => {
    const { storage } = makeStorage();
    const project = makeProject();

    // Inserted oldest-first per branch, so insertion order disagrees with
    // recency: only a real ORDER BY updatedAt DESC keeps the newest builds.
    const rows: Record<string, unknown>[] = [
      {
        id: "b2",
        projectId: "p1",
        gitSha: "sha-2",
        gitBranch: "main",
        isDefault: true,
        status: "approved",
        createdAt: "2026-01-10T00:00:00.000Z",
        updatedAt: "2026-01-10T00:00:00.000Z",
      },
      {
        id: "b4",
        projectId: "p1",
        gitSha: "sha-4",
        gitBranch: "feature/xyz",
        isDefault: false,
        status: "approved",
        createdAt: "2026-01-05T00:00:00.000Z",
        updatedAt: "2026-01-05T00:00:00.000Z",
      },
      {
        id: "b1",
        projectId: "p1",
        gitSha: "sha-1",
        gitBranch: "main",
        isDefault: true,
        status: "approved",
        createdAt: "2026-01-15T00:00:00.000Z",
        updatedAt: "2026-01-15T00:00:00.000Z",
      },
      {
        id: "b3",
        projectId: "p1",
        gitSha: "sha-3",
        gitBranch: "feature/xyz",
        isDefault: false,
        status: "approved",
        createdAt: "2026-01-20T00:00:00.000Z",
        updatedAt: "2026-01-20T00:00:00.000Z",
      },
      {
        id: "b5",
        projectId: "p1",
        gitSha: "sha-5",
        gitBranch: "develop",
        isDefault: false,
        status: "approved",
        createdAt: "2026-01-25T00:00:00.000Z",
        updatedAt: "2026-01-25T00:00:00.000Z",
      },
    ];
    const db = await createTestDb(rows);

    const retention = new Retention(db, storage, retentionTables());
    const result = await retention.purge(project, { ttlDays: 30, keepLatestPerBranch: true });

    expect(result.removedBuilds).toBe(2);
    expect(result.removedFiles).toBeGreaterThanOrEqual(0);
    const survivors = await db.list(builds);
    // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- narrows build["id"] to string for toSorted
    expect(survivors.map((build) => build.id as string).toSorted()).toEqual(["b1", "b3", "b5"]);
  });

  it("purges all terminal builds when keepLatestPerBranch is false", async () => {
    const { storage } = makeStorage();

    const rows: Record<string, unknown>[] = [
      {
        id: "b1",
        projectId: "p2",
        gitSha: "sha-1",
        gitBranch: "main",
        isDefault: true,
        status: "approved",
        createdAt: "2026-01-15T00:00:00.000Z",
        updatedAt: "2026-01-15T00:00:00.000Z",
      },
      {
        id: "b2",
        projectId: "p2",
        gitSha: "sha-2",
        gitBranch: "main",
        isDefault: true,
        status: "approved",
        createdAt: "2026-01-10T00:00:00.000Z",
        updatedAt: "2026-01-10T00:00:00.000Z",
      },
    ];
    const db = await createTestDb(rows);
    const project = makeProject({ id: "p2", name: "Full Purge Test", slug: "full-purge-test" });

    const retention = new Retention(db, storage, retentionTables());
    const result = await retention.purge(project, { ttlDays: 30, keepLatestPerBranch: false });

    expect(result.removedBuilds).toBe(2);
  });

  it("skips non-terminal builds", async () => {
    const { storage } = makeStorage();

    const rows: Record<string, unknown>[] = [
      {
        id: "b1",
        projectId: "p3",
        gitSha: "sha-1",
        gitBranch: "main",
        isDefault: true,
        status: "pending",
        createdAt: "2026-01-15T00:00:00.000Z",
        updatedAt: "2026-01-15T00:00:00.000Z",
      },
      {
        id: "b2",
        projectId: "p3",
        gitSha: "sha-2",
        gitBranch: "main",
        isDefault: true,
        status: "pending",
        createdAt: "2026-01-10T00:00:00.000Z",
        updatedAt: "2026-01-10T00:00:00.000Z",
      },
    ];
    const db = await createTestDb(rows);
    const project = makeProject({ id: "p3", name: "Non-Terminal Test", slug: "non-terminal-test" });

    const retention = new Retention(db, storage, retentionTables());
    const result = await retention.purge(project, { ttlDays: 30, keepLatestPerBranch: true });

    expect(result.removedBuilds).toBe(0);
  });
});
