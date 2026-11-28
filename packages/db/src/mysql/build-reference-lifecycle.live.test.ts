/**
 * Build retention (ADR 0039) on a real MySQL server: the shared `buildReferenceContractSuite`,
 * `retentionActivationContractSuite` and `retentionSkippedContractSuite`, run unchanged, plus the
 * races only a real server can show (preparation against a writer, a second booting instance, a
 * deletion claim) and the adapter's own boot. Every party has its own pool, so row and named locks
 * cross real sessions; no driver or transaction is mocked.
 *
 * Needs a disposable database: `LIVE_CLOUD=1`, `MYSQL_SCHEMA_MUTATION_TEST=1` (the suite deletes
 * every `content_uses` row and its collector passes claim every idle hash) and `MYSQL_DATABASE_URL`,
 * whose user may create databases: the file works in scratch databases on that server, dropped after.
 * The CI job `mysql-lifecycle` and the nightly MySQL job set them against a `mysql:8.0` container.
 */
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import {
  buildReferenceContractSuite,
  retentionActivationContractSuite,
  retentionReadOnlyContractSuite,
  retentionSkippedContractSuite,
} from "@storyshelf/core/test-helpers";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prepareBaselineReferences } from "./baseline-preparation.ts";
import { createBuildReferenceLifecycle } from "./build-reference-lifecycle.ts";
import { createMysqlDatabase } from "./index.ts";
import type { LifecyclePool } from "./lifecycle-transaction.ts";
import { activateRetention, type RetentionActivation } from "./retention-activation.ts";
import { schema } from "./schema/index.ts";
import {
  claimsManyIdleHashes,
  freshProject,
  marker,
  recordsManyHashes,
  seed,
  seeding,
} from "./test-fixtures/retention-support.ts";

const silent = createShelfLogger({ level: "silent" });
const serverUrl = process.env["MYSQL_DATABASE_URL"] ?? "";
const LIVE =
  process.env["LIVE_CLOUD"] === "1" &&
  process.env["MYSQL_SCHEMA_MUTATION_TEST"] === "1" &&
  serverUrl !== "";

/**
 * The URL of a new database on the server of `MYSQL_DATABASE_URL`. The live files run in parallel
 * against that one database (and one drops columns), so this file works only in scratch databases.
 */
function scratchUrl(prefix: string): { name: string; url: string } {
  const name = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const own = new URL(serverUrl === "" ? "mysql://localhost/none" : serverUrl);
  own.pathname = `/${name}`;
  return { name, url: own.toString() };
}

const scratch = scratchUrl("shelf_lifecycle");

function lifecyclePool(pool: mysql.Pool): LifecyclePool {
  return pool as unknown as LifecyclePool;
}

/** Statements on the server, outside any database this file uses. */
async function onServer(statement: string): Promise<void> {
  const admin = await mysql.createConnection({ uri: serverUrl });
  try {
    await admin.query(statement);
  } finally {
    await admin.end();
  }
}
const url = scratch.url;
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/** A promise and the means to settle it, for holding one side of a race. */
function deferred(): { promise: Promise<null>; resolve: () => void } {
  const { promise, resolve } = Promise.withResolvers<null>();
  return { promise, resolve: () => resolve(null) };
}

describe.skipIf(!LIVE)("real MySQL, one pool per party", () => {
  // Three parties and an observer, each with sessions of its own.
  const pools = [0, 1, 2, 3].map(() =>
    mysql.createPool({ uri: url, dateStrings: true, connectionLimit: 4 }),
  );
  const [one, two, three, observer] = pools as [mysql.Pool, mysql.Pool, mysql.Pool, mysql.Pool];
  const adapters: DatabaseAdapter[] = [];
  beforeAll(async () => {
    await onServer(`CREATE DATABASE ${scratch.name}`);
  });
  afterAll(async () => {
    await Promise.all(adapters.map(async (adapter) => await adapter.lifecycle?.teardown()));
    await Promise.all(pools.map(async (pool) => await pool.end()));
    await onServer(`DROP DATABASE IF EXISTS ${scratch.name}`);
  });

  /** An adapter on its own pool, migrated (and, on MySQL 8, activated). */
  async function booted(): Promise<DatabaseAdapter> {
    const adapter = createMysqlDatabase({ url });
    adapters.push(adapter);
    await adapter.lifecycle?.setup({ config: {}, logger: silent });
    return adapter;
  }

  /** Resolve once a session waits on a row lock or a named lock, as the observer sees it. */
  async function untilLockWait(): Promise<void> {
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- poll until the wait shows
      const [rows] = await observer.query(`SELECT
          (SELECT COUNT(*) FROM performance_schema.data_lock_waits)
          + (SELECT COUNT(*) FROM information_schema.processlist WHERE state = 'User lock') AS n`);
      if (Number((rows as { n: unknown }[])[0]?.n) > 0) return;
      // oxlint-disable-next-line no-await-in-loop -- a short pause between polls
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async function count(name: string): Promise<number> {
    const [rows] = await observer.query("SELECT COUNT(*) AS n FROM projects WHERE name = ?", [
      name,
    ]);
    return Number((rows as { n: unknown }[])[0]?.n);
  }

  buildReferenceContractSuite("MySQL (real server)", async (run) => {
    const adapter = await booted();
    const seeded = await seed(adapter);
    await run({
      first: createBuildReferenceLifecycle(lifecyclePool(one)),
      second: createBuildReferenceLifecycle(lifecyclePool(two)),
      owner: seeded.owner,
      buildIds: seeded.buildIds,
      marker: marker(seeded.run, count),
    });
  });

  it("records tens of thousands of hashes in one call", async () => {
    await recordsManyHashes(await booted(), createBuildReferenceLifecycle(lifecyclePool(one)));
  });

  it("claims tens of thousands of idle hashes in one pass", async () => {
    await claimsManyIdleHashes(await booted(), createBuildReferenceLifecycle(lifecyclePool(one)));
  });

  /** Party n's pool, for the lifecycle and preparation. */
  const partyPool = (n: 0 | 1 | 2): LifecyclePool => lifecyclePool([one, two, three][n] ?? one);

  /** An adapter with a fresh project `p`. */
  async function fresh() {
    const adapter = await booted();
    await freshProject(adapter);
    return adapter;
  }

  retentionActivationContractSuite("MySQL (real server)", async (run) => {
    const adapter = await fresh();
    await run({
      lifecycle: createBuildReferenceLifecycle(partyPool(1)),
      prepare: async () => {
        const state: RetentionActivation = {};
        await activateRetention({ pool: partyPool(0) }, state);
        return state.pause;
      },
      ...seeding(adapter),
    });
  });

  it("resumes after a preparation that failed at its last step, leaving nothing behind", async () => {
    const adapter = await fresh();
    await seeding(adapter).seed.baseline({ id: "base", sourceBuildId: "one" });
    const lifecycle = createBuildReferenceLifecycle(partyPool(1));
    const owner = { projectId: "p", type: "baseline", id: "base" } as const;

    await expect(
      prepareBaselineReferences(partyPool(0), async () => {
        throw new Error("interrupted");
      }),
    ).rejects.toThrow("interrupted");

    // The pin and the generation it advanced rolled back with the transaction.
    expect(await lifecycle.referenceGeneration(owner)).toBe(0);
    expect(await lifecycle.claimDeletion("p", "one")).toBe("claimed");
    await observer.query("UPDATE builds SET retention_state = 'available' WHERE id = 'one'");

    expect(await prepareBaselineReferences(partyPool(0))).toEqual({
      protected: 1,
      unknown: 0,
      unavailable: 0,
    });
    expect(await lifecycle.claimDeletion("p", "one")).toBe("protected");
  });

  it("makes a fenced writer wait for preparation, then fail on the generation it advanced", async () => {
    const adapter = await fresh();
    await seeding(adapter).seed.baseline({ id: "base", sourceBuildId: "one" });
    const writer = createBuildReferenceLifecycle(partyPool(1));
    const owner = { projectId: "p", type: "baseline", id: "base" } as const;
    const held = deferred();
    const atLastStep = deferred();

    const preparing = prepareBaselineReferences(partyPool(0), async () => {
      atLastStep.resolve();
      await held.promise;
    });
    await atLastStep.promise;
    let finished = false;
    const racing = writer
      .replaceFencedReferences(owner, 0, ["two"], async () => null)
      .finally(() => {
        finished = true;
      });
    const outcome = racing.then(
      () => "won",
      (error: unknown) => (error as Error).constructor.name,
    );
    await untilLockWait();
    expect(finished).toBe(false);

    held.resolve();
    await preparing;
    // The writer saw generation 0 before preparation; it now sees 1 and is rejected, not merged.
    expect(await outcome).toBe("ReferenceGenerationConflict");
    expect(await writer.referenceGeneration(owner)).toBe(1);
  });

  it("waits for a fenced writer already in flight, then reconciles with what it committed", async () => {
    const adapter = await fresh();
    await seeding(adapter).seed.baseline({ id: "base", sourceBuildId: "one" });
    const writer = createBuildReferenceLifecycle(partyPool(1));
    const owner = { projectId: "p", type: "baseline", id: "base" } as const;
    const held = deferred();
    const writerHolds = deferred();

    const writing = writer.replaceFencedReferences(owner, 0, ["two"], async () => {
      writerHolds.resolve();
      await held.promise;
      return null;
    });
    await writerHolds.promise;
    let prepared = false;
    const preparing = prepareBaselineReferences(partyPool(0)).then((result) => {
      prepared = true;
      return result;
    });
    await untilLockWait();
    expect(prepared).toBe(false);

    held.resolve();
    await writing;
    await preparing;
    // Preparation ran after the writer: the baseline's proven source replaced the writer's pin.
    expect(await writer.referenceGeneration(owner)).toBe(2);
    expect(await writer.claimDeletion("p", "two")).toBe("claimed");
    expect(await writer.claimDeletion("p", "one")).toBe("protected");
  });

  it("lets a second instance boot while the first is preparing, and changes nothing twice", async () => {
    const adapter = await fresh();
    await seeding(adapter).seed.baseline({ id: "base", sourceBuildId: "one" });

    const [first, second] = await Promise.all([
      prepareBaselineReferences(partyPool(0)),
      prepareBaselineReferences(partyPool(1)),
    ]);

    expect(first).toEqual(second);
    const lifecycle = createBuildReferenceLifecycle(partyPool(2));
    expect(
      await lifecycle.referenceGeneration({ projectId: "p", type: "baseline", id: "base" }),
    ).toBe(1);
  });

  it("does not let a deletion claim slip between the check and the pin", async () => {
    const adapter = await fresh();
    await seeding(adapter).seed.baseline({ id: "base", sourceBuildId: "one" });
    const claimer = createBuildReferenceLifecycle(partyPool(1));

    const [claim] = await Promise.allSettled([
      claimer.claimDeletion("p", "one"),
      prepareBaselineReferences(partyPool(0)).catch((): null => null),
    ]);

    const [rows] = await observer.query(
      "SELECT COUNT(*) AS n FROM build_references WHERE build_id = 'one'",
    );
    const pinned = Number((rows as { n: unknown }[])[0]?.n) > 0;
    const claimed = claim.status === "fulfilled" && claim.value === "claimed";
    expect(pinned).toBe(!claimed);
  });

  it("holds a use of a hash until a collector's claim of it commits, then refuses it", async () => {
    const adapter = await booted();
    const seeded = await seed(adapter);
    const { projectId } = seeded.owner;
    const [first, second] = seeded.buildIds;
    const lifecycle = createBuildReferenceLifecycle(lifecyclePool(one));
    const hash = `race-${seeded.run}`;
    expect(await lifecycle.recordContentUses(projectId, first, [hash])).toEqual([]);
    expect(await lifecycle.claimDeletion(projectId, first)).toBe("claimed");
    expect(await lifecycle.releaseBuildContent(projectId, first, [hash])).toBe("done");

    // A collector and an upload of the same hash race from their own pools: exactly one wins.
    const collector = createBuildReferenceLifecycle(lifecyclePool(two));
    const uploader = createBuildReferenceLifecycle(lifecyclePool(three));
    const [claimed, refused] = await Promise.all([
      collector.claimContent("race", "9999-12-31T00:00:00.000Z", "2000-01-01T00:00:00.000Z"),
      uploader.recordContentUses(projectId, second, [hash]),
    ]);
    const collected = claimed.includes(hash);
    expect(refused).toEqual(collected ? [hash] : []);
    expect(await collector.holdsContentClaim(hash, "race")).toBe(collected);
  });

  it("exposes the capability on the adapter after setup, and reports a pause when a source is tombstoned", async () => {
    const adapter = await booted();
    await freshProject(adapter);
    await adapter.lifecycle?.setup({ config: {}, logger: silent });
    expect(adapter.buildReferenceLifecycle).toBeDefined();
    expect(adapter.retentionPause).toBeUndefined();

    await seeding(adapter).seed.baseline({ id: "base", sourceBuildId: "two" });
    await observer.query("UPDATE builds SET retention_state = 'deleting' WHERE id = 'two'");
    const error = vi.fn();
    adapter.setLogger?.({ ...silent, error } as never);
    await adapter.lifecycle?.setup({ config: {}, logger: silent });

    expect(adapter.buildReferenceLifecycle).toBeUndefined();
    expect(adapter.retentionPause).toEqual({
      baselineId: "base",
      buildId: "two",
      problem: "tombstoned",
    });
    expect(error).toHaveBeenCalledTimes(1);

    // The operator removes the baseline and restarts: retention turns on.
    await adapter.remove(schema.baselines, "base");
    await adapter.lifecycle?.setup({ config: {}, logger: silent });
    expect(adapter.retentionPause).toBeUndefined();
    expect(adapter.buildReferenceLifecycle).toBeDefined();
  });

  it("keeps an injected single connection and the unverified presets fail closed on the same server", async () => {
    const connection = await mysql.createConnection({ uri: url, dateStrings: true });
    try {
      const single = createMysqlDatabase({ client: connection });
      const warn = vi.fn();
      single.setLogger?.({ ...silent, warn } as never);
      await single.lifecycle?.setup({ config: {}, logger: silent });
      expect(single.buildReferenceLifecycle).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      await connection.end();
    }
  });

  // Its cases number their projects from one, as on a new database, so each gets a database of its own.
  retentionSkippedContractSuite("MySQL (real server)", async (use) => {
    const { name, url: own } = scratchUrl("shelf_skipped");
    await onServer(`CREATE DATABASE ${name}`);
    const adapter = createMysqlDatabase({ url: own });
    try {
      await adapter.lifecycle?.setup({ config: {}, logger: silent });
      expect(adapter.buildReferenceLifecycle).toBeDefined();
      await use(adapter);
    } finally {
      await adapter.lifecycle?.teardown();
      await onServer(`DROP DATABASE ${name}`);
    }
  });
});

describe.skipIf(!LIVE)("real MySQL, read-only activation in a scratch database", () => {
  retentionReadOnlyContractSuite("MySQL (real server)", async (run) => {
    const readonly = scratchUrl("shelf_readonly");
    await onServer(`CREATE DATABASE ${readonly.name}`);
    const opened: DatabaseAdapter[] = [];
    const open = (): DatabaseAdapter => {
      const db = createMysqlDatabase({ url: readonly.url });
      opened.push(db);
      return db;
    };
    try {
      await run({
        open,
        boot: async (release) => {
          const db = open();
          await db.lifecycle?.setup({ config: {}, logger: silent, release });
          return db;
        },
      });
    } finally {
      await Promise.all(opened.map(async (db) => await db.lifecycle?.teardown()));
      await onServer(`DROP DATABASE IF EXISTS ${readonly.name}`);
    }
  });
});
