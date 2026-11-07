/** The steps of a claimed build's cleanup, asserted on the rows they leave (PGlite). */
import { PGlite } from "@electric-sql/pglite";
import { createShelfLogger } from "@storyshelf/core/logger";
import { drizzle } from "drizzle-orm/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  completeDeletion,
  listDeleting,
  markStorageDeleted,
  releaseBuildContent,
} from "./build-deletion-steps.ts";
import { createBuildReferenceLifecycle } from "./build-reference-lifecycle.ts";
import { createPgliteDatabase } from "./pglite.ts";
import { schema } from "./schema/index.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });
const now = "2026-01-01T00:00:00.000Z";
const client = new PGlite();
const db = drizzle(client, { schema });
const lifecycle = createBuildReferenceLifecycle(db);

beforeAll(async () => {
  const adapter = createPgliteDatabase({ client });
  await adapter.lifecycle?.setup({ config: {}, logger: createShelfLogger({ level: "silent" }) });
});
afterAll(async () => {
  await client.close();
});

/** A project and one build; with `claimed`, the build is tombstoned and has recorded three uses. */
async function seedBuild(claimed: boolean) {
  const run = randomUUID();
  const projectId = `p-${run}`;
  const buildId = `b-${run}`;
  const hashes = ["a", "b", "c"].map((name) => `${name}-${run}`);
  const adapter = createPgliteDatabase({ client });
  await adapter.insert(schema.projects, {
    id: projectId,
    name: "P",
    slug: projectId,
    createdAt: now,
    updatedAt: now,
  });
  await adapter.insert(schema.builds, {
    id: buildId,
    projectId,
    gitSha: "sha",
    gitBranch: "main",
    status: "approved",
    createdAt: now,
    updatedAt: now,
  });
  if (claimed) {
    expect(await lifecycle.recordContentUses(projectId, buildId, hashes)).toEqual([]);
    expect(await lifecycle.claimDeletion(projectId, buildId)).toBe("claimed");
  }
  return { projectId, buildId, hashes };
}

/** Rows of a progress table for the build (`builds` itself is keyed by `id`). */
async function count(table: string, buildId: string): Promise<number> {
  const key = table === "builds" ? "id" : "build_id";
  const result = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ${table} WHERE ${key} = $1`,
    [buildId],
  );
  return Number(result.rows[0]?.n);
}

async function unreleasedUses(buildId: string): Promise<number> {
  const result = await client.query<{ n: string }>(
    "SELECT COUNT(*)::text AS n FROM content_uses WHERE build_id = $1 AND released_at IS NULL",
    [buildId],
  );
  return Number(result.rows[0]?.n);
}

describe("releaseBuildContent", () => {
  it("records each distinct hash once and releases every use of the build", async () => {
    const { projectId, buildId, hashes } = await seedBuild(true);
    const [first, second] = hashes;
    // The manifest names two hashes (one twice); the build holds a third use the manifest lacks.
    const result = await releaseBuildContent(db, projectId, buildId, [
      first,
      first,
      second,
    ] as string[]);

    expect(result).toBe("done");
    expect(await count("build_content_releases", buildId)).toBe(2);
    expect(await unreleasedUses(buildId)).toBe(0);
    expect(await count("build_deletions", buildId)).toBe(1);
  });

  it("changes nothing when it is repeated", async () => {
    const { projectId, buildId, hashes } = await seedBuild(true);
    expect(await releaseBuildContent(db, projectId, buildId, hashes)).toBe("done");

    expect(await releaseBuildContent(db, projectId, buildId, hashes)).toBe("already-done");
    expect(await count("build_content_releases", buildId)).toBe(3);
  });

  it("does nothing for a build that is not being deleted", async () => {
    const { projectId, buildId, hashes } = await seedBuild(false);

    expect(await releaseBuildContent(db, projectId, buildId, hashes)).toBe("not-deleting");
    expect(await count("build_content_releases", buildId)).toBe(0);
    expect(await count("build_deletions", buildId)).toBe(0);
  });

  it("records an empty manifest and still releases the uses", async () => {
    const { projectId, buildId } = await seedBuild(true);

    expect(await releaseBuildContent(db, projectId, buildId, [])).toBe("done");
    expect(await count("build_content_releases", buildId)).toBe(0);
    expect(await unreleasedUses(buildId)).toBe(0);
  });
});

describe("the steps in order", () => {
  it("refuses a step taken out of order and finishes in order", async () => {
    const { projectId, buildId, hashes } = await seedBuild(true);
    const removeBuild = async (tx: Parameters<Parameters<typeof completeDeletion>[3]>[0]) => {
      await tx.remove(schema.builds, buildId);
      return "removed";
    };

    expect(await markStorageDeleted(db, projectId, buildId)).toBe("out-of-order");
    expect(await releaseBuildContent(db, projectId, buildId, hashes)).toBe("done");
    expect(await completeDeletion(db, projectId, buildId, removeBuild)).toBe("out-of-order");
    expect(await markStorageDeleted(db, projectId, buildId)).toBe("done");
    expect(await markStorageDeleted(db, projectId, buildId)).toBe("already-done");
    expect(await completeDeletion(db, projectId, buildId, removeBuild)).toEqual({
      result: "removed",
    });

    // The build, its progress record and its release records are gone; a second cleaner learns that.
    expect(await count("builds", buildId)).toBe(0);
    expect(await count("build_deletions", buildId)).toBe(0);
    expect(await count("build_content_releases", buildId)).toBe(0);
    expect(await completeDeletion(db, projectId, buildId, removeBuild)).toBe("not-deleting");
  });

  it("keeps the build and its records when removing the rows fails", async () => {
    const { projectId, buildId, hashes } = await seedBuild(true);
    await releaseBuildContent(db, projectId, buildId, hashes);
    await markStorageDeleted(db, projectId, buildId);

    await expect(
      completeDeletion(db, projectId, buildId, async (tx) => {
        await tx.remove(schema.builds, buildId);
        throw new Error("cleanup failed");
      }),
    ).rejects.toThrow("cleanup failed");

    expect(await count("builds", buildId)).toBe(1);
    expect(await count("build_deletions", buildId)).toBe(1);
    expect(await count("build_content_releases", buildId)).toBe(3);
  });
});

describe("listDeleting", () => {
  it("lists the project's deleting builds with the steps they have taken", async () => {
    const { projectId, buildId, hashes } = await seedBuild(true);
    const other = await seedBuild(true);

    const before = await listDeleting(db, projectId);
    expect(before).toEqual([{ projectId, buildId, contentReleased: false, storageDeleted: false }]);

    await releaseBuildContent(db, projectId, buildId, hashes);
    expect(await listDeleting(db, projectId)).toEqual([
      { projectId, buildId, contentReleased: true, storageDeleted: false },
    ]);
    await markStorageDeleted(db, projectId, buildId);
    expect(await listDeleting(db, projectId)).toEqual([
      { projectId, buildId, contentReleased: true, storageDeleted: true },
    ]);
    // Another project's deleting build is not listed.
    expect(await listDeleting(db, other.projectId)).toHaveLength(1);
  });
});
