import type { BuildReferenceLifecycle, DatabaseAdapter } from "@storyshelf/core/adapter/database";
/** Seeding and helpers shared by the Postgres retention suites (every preset runs the same contract). */
import type {
  BuildReferenceContractFixture,
  RetentionActivationHarness,
} from "@storyshelf/core/test-helpers";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { schema } from "../schema/index.ts";

export const now = "2026-01-01T00:00:00.000Z";

/** A project with two available builds; every id carries the run's suffix, so a shared database needs no cleanup. */
export async function seed(
  adapter: DatabaseAdapter,
): Promise<Pick<BuildReferenceContractFixture, "owner" | "buildIds"> & { run: string }> {
  // Content hashes are global, not per project: start each fixture without earlier uses and claims.
  await adapter.all(sql`DELETE FROM content_uses`);
  const run = randomUUID();
  const projectId = `p-${run}`;
  await adapter.insert(schema.projects, {
    id: projectId,
    name: "P",
    slug: projectId,
    createdAt: now,
    updatedAt: now,
  });
  const buildIds = [`one-${run}`, `two-${run}`] as const;
  for (const id of buildIds) {
    // oxlint-disable-next-line no-await-in-loop -- two rows, in order
    await adapter.insert(schema.builds, {
      id,
      projectId,
      gitSha: id,
      gitBranch: "main",
      status: "approved",
      createdAt: now,
      updatedAt: now,
    });
  }
  return { run, owner: { projectId, type: "baseline", id: `owner-${run}` }, buildIds };
}

/** A domain write the suite can observe: a project named for this run, counted over `count`. */
export function marker(
  run: string,
  count: (name: string) => Promise<number>,
): BuildReferenceContractFixture["marker"] {
  const name = `marker-${run}`;
  return {
    write: async (tx) => {
      const id = randomUUID();
      await tx.insert(schema.projects, { id, name, slug: id, createdAt: now, updatedAt: now });
    },
    count: async () => await count(name),
  };
}

/**
 * A build with tens of thousands of files records them in one call. One advisory lock per hash would
 * put one entry per file in the shared lock table (about 6400 by default) and fail with
 * "out of shared memory"; the locks are bounded, so this must pass on any server.
 */
export async function recordsManyHashes(
  adapter: DatabaseAdapter,
  lifecycle: BuildReferenceLifecycle,
): Promise<void> {
  const seeded = await seed(adapter);
  const hashes = Array.from({ length: 70_000 }, (_, index) => `many-${seeded.run}-${index}`);
  const buildId = seeded.buildIds[0];
  expect(await lifecycle.recordContentUses(seeded.owner.projectId, buildId, hashes)).toEqual([]);
  // The same call again changes nothing, and a collector pass over them finds them all in use.
  expect(await lifecycle.recordContentUses(seeded.owner.projectId, buildId, hashes)).toEqual([]);
  expect(
    await lifecycle.claimContent("many", "9999-12-31T00:00:00.000Z", "2000-01-01T00:00:00.000Z"),
  ).toEqual([]);
}

/**
 * A build deleted after it recorded tens of thousands of files leaves that many idle hashes. One
 * collector pass claims them all with a fixed number of statements, so the locks it holds do not
 * stall uploads for the time of a round trip per hash.
 */
export async function claimsManyIdleHashes(
  adapter: DatabaseAdapter,
  lifecycle: BuildReferenceLifecycle,
): Promise<void> {
  const seeded = await seed(adapter);
  const { projectId } = seeded.owner;
  const buildId = seeded.buildIds[0];
  const hashes = Array.from({ length: 20_000 }, (_, index) => `idle-${seeded.run}-${index}`);
  expect(await lifecycle.recordContentUses(projectId, buildId, hashes)).toEqual([]);
  expect(await lifecycle.claimDeletion(projectId, buildId)).toBe("claimed");
  expect(await lifecycle.releaseBuildContent(projectId, buildId, [])).toBe("done");
  const claimed = await lifecycle.claimContent(
    "pass",
    "9999-12-31T00:00:00.000Z",
    "2000-01-01T00:00:00.000Z",
  );
  await expectClaimedAndHeld(lifecycle, seeded, claimed, hashes);
}

/** Every idle hash was claimed; the pass's token holds them and a new use of one is refused. */
async function expectClaimedAndHeld(
  lifecycle: BuildReferenceLifecycle,
  seeded: Awaited<ReturnType<typeof seed>>,
  claimed: readonly string[],
  hashes: readonly string[],
): Promise<void> {
  const { projectId } = seeded.owner;
  expect(claimed).toHaveLength(hashes.length);
  expect(new Set(claimed)).toEqual(new Set(hashes));
  // Claimed hashes are held by the pass's token and refuse a new use.
  expect(await lifecycle.holdsContentClaim(hashes[0] ?? "", "pass")).toBe(true);
  expect(
    await lifecycle.recordContentUses(projectId, seeded.buildIds[1], hashes.slice(0, 2)),
  ).toEqual(hashes.slice(0, 2));
}

const baselineRow = {
  projectId: "p",
  storyId: "story",
  viewportName: "desktop",
  branch: "main",
  browser: "chromium",
  screenshotPath: "shot",
  createdAt: now,
  updatedAt: now,
};

/**
 * Remove the projects this suite seeds (`p`, `q`) and everything under them, then seed `p` with
 * builds `one` and `two`. Scoped by id, never a truncate: other files share the database.
 */
export async function freshProject(adapter: DatabaseAdapter): Promise<void> {
  for (const table of [
    "build_references",
    "build_reference_generations",
    "baselines",
    "snapshots",
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- a few deletes, in order
    await adapter.all(sql`DELETE FROM ${sql.identifier(table)} WHERE project_id IN ('p', 'q')`);
  }
  await adapter.all(sql`DELETE FROM builds WHERE project_id IN ('p', 'q')`);
  await adapter.all(sql`DELETE FROM projects WHERE id IN ('p', 'q')`);
  await adapter.insert(schema.projects, {
    id: "p",
    name: "Project",
    slug: "p",
    createdAt: now,
    updatedAt: now,
  });
  for (const id of ["one", "two"]) {
    // oxlint-disable-next-line no-await-in-loop -- two rows, in order
    await adapter.insert(schema.builds, {
      id,
      projectId: "p",
      gitSha: id,
      gitBranch: "main",
      status: "approved",
      createdAt: now,
      updatedAt: now,
    });
  }
}

/** The suite's seeding and reading, over any adapter on the database being prepared. */
export function seeding(
  adapter: DatabaseAdapter,
): Pick<RetentionActivationHarness, "seed" | "baselineSource"> {
  return {
    seed: {
      baseline: async (row: Parameters<typeof baselineInsert>[0]) => {
        await adapter.insert(schema.baselines, baselineInsert(row));
      },
      snapshot: async (row: {
        id: string;
        buildId: string;
        storyId: string;
        inherited: boolean;
        sourceBuildId: string | null;
      }) => {
        await adapter.insert(schema.snapshots, {
          projectId: "p",
          storyName: "Story",
          storyTitle: "Story",
          viewportName: "desktop",
          browser: "chromium",
          screenshotPath: "shot",
          createdAt: now,
          updatedAt: now,
          ...row,
        });
      },
      foreignBuild: async (id: string) => {
        await adapter.insert(schema.projects, {
          id: "q",
          name: "Other",
          slug: "q",
          createdAt: now,
          updatedAt: now,
        });
        await adapter.insert(schema.builds, {
          id,
          projectId: "q",
          gitSha: id,
          gitBranch: "main",
          createdAt: now,
          updatedAt: now,
        });
      },
    },
    baselineSource: async (id: string) =>
      ((await adapter.get(schema.baselines, id))?.["sourceBuildId"] as string | null | undefined) ??
      null,
  };
}

export function baselineInsert(row: {
  id: string;
  storyId?: string;
  sourceBuildId?: string | null;
  snapshotId?: string | null;
}): typeof schema.baselines.$inferInsert {
  return {
    ...baselineRow,
    storyId: row.storyId ?? row.id,
    ...row,
    snapshotId: row.snapshotId === undefined ? "snap" : row.snapshotId,
  };
}
