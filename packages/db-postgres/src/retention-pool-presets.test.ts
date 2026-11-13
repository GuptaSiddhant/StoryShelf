/**
 * Retention on the pooled Postgres presets (ADR 0039): `pg` and `./neon`. Each runs the shared
 * `buildReferenceContractSuite` and `retentionActivationContractSuite` unchanged, every party on its
 * own pool, so row locks cross real sessions. A preset is enabled only while both pass.
 *
 * Needs a disposable server: `LIVE_CLOUD=1`, `POSTGRES_SCHEMA_MUTATION_TEST=1` and `DATABASE_URL`
 * (the CI job `postgres-lifecycle` sets them). `./neon` also needs `NEON_WSPROXY`
 * (`host:port/v1` of a `wsproxy` in front of that server), which the job provides as a service.
 * The capability exists only on a `Pool`: an injected single connection stays fail closed, and
 * that part is hermetic. `./neon-http` never exposes it (`transactions: "sequential"`).
 */
import { neonConfig, Pool as NeonPool } from "@neondatabase/serverless";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import {
  buildReferenceContractSuite,
  retentionActivationContractSuite,
} from "@storyshelf/core/test-helpers";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool as PgPool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { createNeonDatabase } from "./neon.ts";
import { createPgDatabase } from "./pg.ts";
import { activateRetention, type RetentionActivation } from "./retention-activation.ts";
import {
  claimsManyIdleHashes,
  freshProject,
  marker,
  recordsManyHashes,
  seed,
  seeding,
} from "./test-fixtures/retention-support.ts";

const silent = createShelfLogger({ level: "silent" });
const url = process.env["DATABASE_URL"] ?? "";
const LIVE =
  process.env["LIVE_CLOUD"] === "1" &&
  process.env["POSTGRES_SCHEMA_MUTATION_TEST"] === "1" &&
  url !== "";
const wsproxy = process.env["NEON_WSPROXY"] ?? "";
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

interface Preset {
  name: string;
  /** A new pool on the shared server: one per party, so nothing shares a session. */
  pool(): { end(): Promise<void> };
  /** The preset's adapter over a pool. */
  adapter(pool: never): DatabaseAdapter;
  /** Drizzle over a pool, as the preset builds it. */
  database(pool: never): unknown;
  /** Rows of a statement on a pool, for the observer. */
  count(pool: never, name: string): Promise<number>;
}

const COUNT = "SELECT COUNT(*)::int AS n FROM projects WHERE name = $1";

const pgPreset: Preset = {
  name: "pg",
  pool: () => new PgPool({ connectionString: url, max: 3 }),
  adapter: (pool) => createPgDatabase({ client: pool }),
  database: (pool) => drizzlePg(pool),
  count: async (pool, name) =>
    ((await (pool as PgPool).query(COUNT, [name])).rows[0] as { n: number }).n,
};

const neonPreset: Preset = {
  name: "neon",
  pool: () => new NeonPool({ connectionString: url, max: 3 }),
  adapter: (pool) => createNeonDatabase({ client: pool }),
  database: (pool) => drizzleNeon(pool),
  count: async (pool, name) =>
    ((await (pool as NeonPool).query(COUNT, [name])).rows[0] as { n: number }).n,
};

/** Point the Neon driver at a local `wsproxy` instead of Neon's cloud proxy. */
function useLocalWsProxy(): void {
  neonConfig.wsProxy = () => wsproxy;
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineTLS = false;
  neonConfig.pipelineConnect = false;
}

/** The contract suites on one preset, every party on its own pool. */
function runPreset(preset: Preset): void {
  let pools: { end(): Promise<void> }[] = [];
  const open = () => {
    const pool = preset.pool();
    pools.push(pool);
    return pool as never;
  };
  /** Run `fn`, then end every pool it opened: a test leaves no connection behind. */
  const scoped = async <R>(fn: () => Promise<R>): Promise<R> => {
    const mine: { end(): Promise<void> }[] = [];
    pools = mine;
    try {
      return await fn();
    } finally {
      await Promise.all(mine.map(async (pool) => await pool.end()));
    }
  };

  /**
   * An adapter on its own pool, set up. A baseline an earlier test left behind (a recorded source
   * that is missing or foreign) would pause retention at boot, so the seed projects are emptied
   * first and the adapter is set up again on the clean database.
   */
  async function booted(): Promise<DatabaseAdapter> {
    const adapter = preset.adapter(open());
    await adapter.lifecycle?.setup({ config: {}, logger: silent });
    await freshProject(adapter);
    await adapter.lifecycle?.setup({ config: {}, logger: silent });
    return adapter;
  }

  it("exposes the capability on a pool after setup", async () => {
    await scoped(async () => {
      const adapter = await booted();
      expect(adapter.buildReferenceLifecycle).toBeDefined();
      expect(adapter.retentionPause).toBeUndefined();
    });
  });

  buildReferenceContractSuite(`${preset.name} (real server)`, async (run) => {
    await scoped(async () => {
      const adapter = await booted();
      const reader = open();
      const second = await booted();
      const seeded = await seed(adapter);
      const first = adapter.buildReferenceLifecycle;
      const other = second.buildReferenceLifecycle;
      if (!first || !other) throw new Error("the preset did not expose the lifecycle");
      await run({
        first,
        second: other,
        owner: seeded.owner,
        buildIds: seeded.buildIds,
        marker: marker(seeded.run, async (name) => await preset.count(reader, name)),
      });
    });
  });

  it("records and claims tens of thousands of hashes", async () => {
    await scoped(async () => {
      const adapter = await booted();
      const lifecycle = adapter.buildReferenceLifecycle;
      if (!lifecycle) throw new Error("the preset did not expose the lifecycle");
      await recordsManyHashes(adapter, lifecycle);
      await claimsManyIdleHashes(adapter, lifecycle);
    });
    // Tens of thousands of hashes cross the WebSocket proxy on `./neon`: allow it more than the default.
  }, 240_000);

  retentionActivationContractSuite(`${preset.name} (real server)`, async (run) => {
    await scoped(async () => {
      const adapter = await booted();
      await freshProject(adapter);
      const second = await booted();
      const lifecycle = second.buildReferenceLifecycle;
      if (!lifecycle) throw new Error("the preset did not expose the lifecycle");
      const database = preset.database(open());
      await run({
        lifecycle,
        prepare: async () => {
          const state: RetentionActivation = {};
          await activateRetention(database, state);
          return state.pause;
        },
        ...seeding(adapter),
      });
    });
  });
}

describe.skipIf(!LIVE)("pg preset on a real server", () => runPreset(pgPreset));

describe.skipIf(!LIVE || wsproxy === "")("neon preset on a real server through wsproxy", () => {
  useLocalWsProxy();
  runPreset(neonPreset);
});

describe("a single injected connection keeps the capability off", () => {
  it("pg: a Client is one session", async () => {
    const adapter = createPgDatabase({
      client: {
        query: async () => ({ rows: [] }),
        connect: async () => {},
        end: async () => {},
      } as never,
    });
    await adapter.lifecycle?.setup({ config: {}, logger: silent });
    expect(adapter.buildReferenceLifecycle).toBeUndefined();
    expect(adapter.retentionPause).toBeUndefined();
  });

  it("pg: a PoolClient is one session", async () => {
    const adapter = createPgDatabase({
      client: { query: async () => ({ rows: [] }), release: () => {} } as never,
    });
    await adapter.lifecycle?.setup({ config: {}, logger: silent });
    expect(adapter.buildReferenceLifecycle).toBeUndefined();
  });

  it("neon: a checked-out PoolClient is one session", async () => {
    const adapter = createNeonDatabase({
      client: { query: async () => ({ rows: [] }), release: () => {} } as never,
    });
    await adapter.lifecycle?.setup({ config: {}, logger: silent });
    expect(adapter.buildReferenceLifecycle).toBeUndefined();
  });
});
