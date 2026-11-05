/**
 * The shared build-reference contract (ADR 0039) against Postgres.
 *
 * PGlite always runs. It is one in-process connection, so it proves the SQL (the statements, the
 * constraints, rollback of domain writes) but NOT cross-connection locking: its "first" and "second"
 * lifecycles queue behind each other's transactions. Real Postgres proves the locks. It runs when
 * `LIVE_CLOUD=1` and `DATABASE_URL` are set (the CI job `postgres-lifecycle` and the nightly
 * compatibility workflow), each lifecycle on its own connection.
 */
import { PGlite } from "@electric-sql/pglite";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
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
import { afterAll, describe, vi } from "vitest";
import { createBuildReferenceLifecycle } from "./build-reference-lifecycle.ts";
import { createPostgresDatabase } from "./index.ts";
import { createPgliteDatabase } from "./pglite.ts";
import { schema } from "./schema/index.ts";

const silent = createShelfLogger({ level: "silent" });
const now = "2026-01-01T00:00:00.000Z";
const LIVE = process.env["LIVE_CLOUD"] === "1" && process.env["DATABASE_URL"] !== undefined;
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
});
