import { describe, expect, it } from "vitest";

import { makeDatabase, makeStorage } from "../capture/fake-adapters.ts";
import { Retention } from "./purge.ts";
import type { Project } from "../schema.ts";
import { builds } from "../schema.ts";
import { TERMINAL_BUILD_STATUSES } from "../types.ts";

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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createTestDb(rows: Array<Record<string, unknown>>): ReturnType<typeof makeDatabase>["db"] {
  const { db } = makeDatabase();

  // Insert all rows directly using the fake db's insert
  for (const row of rows) {
    (db as any)._rows = (db as any)._rows || new Map();
    (db as any)._rows.set(row.id as string, row);
  }

  // Override list to filter correctly
  (db as any).list = async (table: any, _opts: any = {}) => {
    if (table !== builds) return [];
    const projectId = rows[0]?.projectId;
    const allRows = [...((db as any)._rows || new Map()).values()];
    const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
    return allRows.filter((r: any) => {
      return r.projectId === projectId
        && TERMINAL_BUILD_STATUSES.includes(r.status)
        && r.updatedAt < cutoff;
    });
  };

  // Override all for latestPerBranch
  (db as any).all = async () => {
    const allRows = [...((db as any)._rows || new Map()).values()];
    const projectId = rows[0]?.projectId;
    return allRows
      .filter((r: any) => r.projectId === projectId)
      .map((r: any) => ({ id: r.id, gitBranch: r.gitBranch, createdAt: r.createdAt }));
  };

  // Override get for LabelModel.hasPersistent
  (db as any).get = async (table: any, id: string) => {
    if (table !== builds) return null;
    return ((db as any)._rows || new Map()).get(id) || null;
  };

  // Override remove for BuildModel.remove
  (db as any).remove = async (table: any, id: string) => {
    if (table === builds) {
      ((db as any)._rows || new Map()).delete(id);
    }
  };

  // Override count for LabelModel.hasPersistent
  (db as any).count = async (table: any, _where?: any) => {
    if (table !== builds) return 0;
    return [...((db as any)._rows || new Map()).values()].length;
  };

  return db;
}

describe("Retention purge integration", () => {
  it("purges terminal builds older than TTL and keeps latest per branch", async () => {
    const { storage } = makeStorage();
    const project = makeProject();

    const rows = [
      { id: "b1", projectId: "p1", gitSha: "sha-1", gitBranch: "main", isDefault: true, status: "approved", createdAt: "2026-01-15T00:00:00.000Z", updatedAt: "2026-01-15T00:00:00.000Z" },
      { id: "b2", projectId: "p1", gitSha: "sha-2", gitBranch: "main", isDefault: true, status: "approved", createdAt: "2026-01-10T00:00:00.000Z", updatedAt: "2026-01-10T00:00:00.000Z" },
      { id: "b3", projectId: "p1", gitSha: "sha-3", gitBranch: "feature/xyz", isDefault: false, status: "approved", createdAt: "2026-01-20T00:00:00.000Z", updatedAt: "2026-01-20T00:00:00.000Z" },
      { id: "b4", projectId: "p1", gitSha: "sha-4", gitBranch: "feature/xyz", isDefault: false, status: "approved", createdAt: "2026-01-05T00:00:00.000Z", updatedAt: "2026-01-05T00:00:00.000Z" },
      { id: "b5", projectId: "p1", gitSha: "sha-5", gitBranch: "develop", isDefault: false, status: "approved", createdAt: "2026-01-25T00:00:00.000Z", updatedAt: "2026-01-25T00:00:00.000Z" },
    ];
    const db = createTestDb(rows);

    const retention = new Retention(db, storage);
    const result = await retention.purge(project, { ttlDays: 30, keepLatestPerBranch: true });

    expect(result.removedBuilds).toBe(2);
    expect(result.removedFiles).toBeGreaterThanOrEqual(0);
  });

  it("purges all terminal builds when keepLatestPerBranch is false", async () => {
    const { storage } = makeStorage();

    const rows = [
      { id: "b1", projectId: "p2", gitSha: "sha-1", gitBranch: "main", isDefault: true, status: "approved", createdAt: "2026-01-15T00:00:00.000Z", updatedAt: "2026-01-15T00:00:00.000Z" },
      { id: "b2", projectId: "p2", gitSha: "sha-2", gitBranch: "main", isDefault: true, status: "approved", createdAt: "2026-01-10T00:00:00.000Z", updatedAt: "2026-01-10T00:00:00.000Z" },
    ];
    const db = createTestDb(rows);
    const project = makeProject({ id: "p2", name: "Full Purge Test", slug: "full-purge-test" });

    const retention = new Retention(db, storage);
    const result = await retention.purge(project, { ttlDays: 30, keepLatestPerBranch: false });

    expect(result.removedBuilds).toBe(2);
  });

  it("skips non-terminal builds", async () => {
    const { storage } = makeStorage();

    const rows = [
      { id: "b1", projectId: "p3", gitSha: "sha-1", gitBranch: "main", isDefault: true, status: "pending", createdAt: "2026-01-15T00:00:00.000Z", updatedAt: "2026-01-15T00:00:00.000Z" },
      { id: "b2", projectId: "p3", gitSha: "sha-2", gitBranch: "main", isDefault: true, status: "pending", createdAt: "2026-01-10T00:00:00.000Z", updatedAt: "2026-01-10T00:00:00.000Z" },
    ];
    const db = createTestDb(rows);
    const project = makeProject({ id: "p3", name: "Non-Terminal Test", slug: "non-terminal-test" });

    const retention = new Retention(db, storage);
    const result = await retention.purge(project, { ttlDays: 30, keepLatestPerBranch: true });

    expect(result.removedBuilds).toBe(0);
  });
});
