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
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import { buildReferenceContractSuite } from "@storyshelf/core/test-helpers";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, it, vi } from "vite-plus/test";
import { createBuildReferenceLifecycle } from "./build-reference-lifecycle.ts";
import { createPostgresDatabase } from "./index.ts";
import { createPgliteDatabase } from "./pglite.ts";
import { schema } from "./schema/index.ts";
import {
  seed,
  marker,
  recordsManyHashes,
  claimsManyIdleHashes,
} from "./test-fixtures/retention-support.ts";

const silent = createShelfLogger({ level: "silent" });
// The live half deletes every `content_uses` row and claims idle ones: only a disposable database may run it.
const LIVE =
  process.env["LIVE_CLOUD"] === "1" &&
  process.env["POSTGRES_SCHEMA_MUTATION_TEST"] === "1" &&
  process.env["DATABASE_URL"] !== undefined;
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

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
