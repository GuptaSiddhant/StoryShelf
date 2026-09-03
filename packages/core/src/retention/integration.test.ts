import { describe, expect, it } from "vitest";

import { makeDatabase, makeStorage } from "../capture/fake-adapters.ts";
import { builds, type Project } from "../schema.ts";
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

async function createTestDb(rows: Record<string, unknown>[]): Promise<ReturnType<typeof makeDatabase>["db"]> {
  const { db } = makeDatabase();

  await Promise.all(
    rows.map(async (row) => {
      await db.insert(builds, row as unknown as typeof builds.$inferInsert);
    }),
  );

  const projectId = rows[0]?.["projectId"] as string | undefined;

  // Override `all` to return latestPerBranch-compatible rows filtered by projectId.
  // The fake adapter's `all` returns every table's rows, so we narrow it here.
  const dbRecord = db as unknown as Record<string, unknown>;
  dbRecord["all"] = async (): Promise<{ id: string; gitBranch: string; createdAt: string }[]> => {
    if (projectId === undefined) {
      return [];
    }
    const filtered = rows
      .filter((row) => row["projectId"] === projectId)
      .map((row) => ({
        id: row["id"] as string,
        gitBranch: row["gitBranch"] as string,
        createdAt: row["createdAt"] as string,
      }));
    // Mirror the real query's ORDER BY createdAt DESC by sorting descending
    filtered.sort((first, second) => second.createdAt.localeCompare(first.createdAt));
    await Promise.resolve();
    return filtered;
  };

  return db;
}

describe("Retention purge integration", () => {
  it("purges terminal builds older than TTL and keeps latest per branch", async () => {
    const { storage } = makeStorage();
    const project = makeProject();

    const rows: Record<string, unknown>[] = [
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

    const retention = new Retention(db, storage);
    const result = await retention.purge(project, { ttlDays: 30, keepLatestPerBranch: true });

    expect(result.removedBuilds).toBe(2);
    expect(result.removedFiles).toBeGreaterThanOrEqual(0);
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

    const retention = new Retention(db, storage);
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

    const retention = new Retention(db, storage);
    const result = await retention.purge(project, { ttlDays: 30, keepLatestPerBranch: true });

    expect(result.removedBuilds).toBe(0);
  });
});
