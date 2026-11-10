/**
 * The shared build-reference contract (ADR 0039) against Postgres.
 *
 * PGlite always runs. It is one in-process connection, so it proves the SQL (the statements, the
 * constraints, rollback of domain writes) but NOT cross-connection locking: its "first" and "second"
 * lifecycles queue behind each other's transactions. Real Postgres proves the locks. It runs when
 * `LIVE_CLOUD=1`, `POSTGRES_SCHEMA_MUTATION_TEST=1` (this database may be wiped: the suite clears
 * `content_uses` and its collector pass claims every idle hash) and `DATABASE_URL` are set, which the
 * CI job `postgres-lifecycle` and the nightly compatibility workflow do against a disposable service
 * container, each lifecycle on its own connection.
 */
import { PGlite } from "@electric-sql/pglite";
import type { BuildReferenceLifecycle, DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import {
  buildReferenceContractSuite,
  type BuildReferenceContractFixture,
} from "@storyshelf/core/test-helpers";
import { sql } from "drizzle-orm";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vite-plus/test";
import { createBuildReferenceLifecycle } from "./build-reference-lifecycle.ts";
import { createPostgresDatabase } from "./index.ts";
import { createPgliteDatabase } from "./pglite.ts";
import { schema } from "./schema/index.ts";

const silent = createShelfLogger({ level: "silent" });
const now = "2026-01-01T00:00:00.000Z";
// The live half deletes every `content_uses` row and claims idle ones: only a disposable database may run it.
const LIVE =
  process.env["LIVE_CLOUD"] === "1" &&
  process.env["POSTGRES_SCHEMA_MUTATION_TEST"] === "1" &&
  process.env["DATABASE_URL"] !== undefined;
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

/** A project with two available builds; every id carries the run's suffix, so a shared database needs no cleanup. */
async function seed(
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
function marker(
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
async function recordsManyHashes(adapter: DatabaseAdapter, lifecycle: BuildReferenceLifecycle) {
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
async function claimsManyIdleHashes(adapter: DatabaseAdapter, lifecycle: BuildReferenceLifecycle) {
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
  expect(claimed).toHaveLength(hashes.length);
  expect(new Set(claimed)).toEqual(new Set(hashes));
  // Claimed hashes are held by the pass's token and refuse a new use.
  expect(await lifecycle.holdsContentClaim(hashes[0] ?? "", "pass")).toBe(true);
  expect(
    await lifecycle.recordContentUses(projectId, seeded.buildIds[1], hashes.slice(0, 2)),
  ).toEqual(hashes.slice(0, 2));
}

let pglite: Promise<{ client: PGlite; adapter: DatabaseAdapter }> | undefined;

async function sharedPglite(): Promise<{ client: PGlite; adapter: DatabaseAdapter }> {
  pglite ??= (async () => {
    const client = new PGlite();
    const adapter = createPgliteDatabase({ client });
    await adapter.lifecycle?.setup({ config: {}, logger: silent });
    return { client, adapter };
  })();
  return await pglite;
}

afterAll(async () => {
  await (await pglite)?.client.close();
});

buildReferenceContractSuite("Postgres (PGlite, one connection)", async (run) => {
  const { client, adapter } = await sharedPglite();
  const lifecycle = createBuildReferenceLifecycle(drizzlePglite(client, { schema }));
  const seeded = await seed(adapter);
  await run({
    first: lifecycle,
    second: createBuildReferenceLifecycle(drizzlePglite(client, { schema })),
    owner: seeded.owner,
    buildIds: seeded.buildIds,
    marker: marker(seeded.run, async (name) => {
      const result = await client.query<{ n: string }>(
        "SELECT COUNT(*)::text AS n FROM projects WHERE name = $1",
        [name],
      );
      return Number(result.rows[0]?.n);
    }),
  });
});

it("claims tens of thousands of idle hashes in one pass (PGlite)", async () => {
  const { client, adapter } = await sharedPglite();
  await claimsManyIdleHashes(
    adapter,
    createBuildReferenceLifecycle(drizzlePglite(client, { schema })),
  );
});

it("records tens of thousands of hashes in one call (PGlite)", async () => {
  const { client, adapter } = await sharedPglite();
  await recordsManyHashes(
    adapter,
    createBuildReferenceLifecycle(drizzlePglite(client, { schema })),
  );
});

describe.skipIf(!LIVE)("real Postgres, one connection per lifecycle", () => {
  const url = process.env["DATABASE_URL"] ?? "";
  const clients = [postgres(url), postgres(url), postgres(url)] as const;
  afterAll(async () => {
    await Promise.all(clients.map(async (client) => await client.end()));
  });

  buildReferenceContractSuite("Postgres (real server)", async (run) => {
    const [one, two, reader] = clients;
    const adapter = createPostgresDatabase({ client: one });
    await adapter.lifecycle?.setup({ config: {}, logger: silent });
    const seeded = await seed(adapter);
    await run({
      first: createBuildReferenceLifecycle(drizzlePostgres(one, { schema })),
      second: createBuildReferenceLifecycle(drizzlePostgres(two, { schema })),
      owner: seeded.owner,
      buildIds: seeded.buildIds,
      marker: marker(seeded.run, async (name) => {
        const rows = await reader`SELECT COUNT(*)::int AS n FROM projects WHERE name = ${name}`;
        return Number(rows[0]?.["n"]);
      }),
    });
  });

  it("records tens of thousands of hashes in one call (real server)", async () => {
    const [one] = clients;
    const adapter = createPostgresDatabase({ client: one });
    await adapter.lifecycle?.setup({ config: {}, logger: silent });
    await recordsManyHashes(
      adapter,
      createBuildReferenceLifecycle(drizzlePostgres(one, { schema })),
    );
  });

  it("claims tens of thousands of idle hashes in one pass (real server)", async () => {
    const [one] = clients;
    const adapter = createPostgresDatabase({ client: one });
    await adapter.lifecycle?.setup({ config: {}, logger: silent });
    await claimsManyIdleHashes(
      adapter,
      createBuildReferenceLifecycle(drizzlePostgres(one, { schema })),
    );
  });
});
