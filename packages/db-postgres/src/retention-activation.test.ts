/**
 * Retention activation on Postgres (ADR 0039): the shared `retentionActivationContractSuite`, run
 * unchanged, plus what needs this dialect's internals: an interrupted preparation that resumes, a
 * fenced writer racing preparation, the adapter's boot and pause, and a booting second instance.
 *
 * PGlite always runs and proves the SQL. Its two "connections" are one session, so the race tests
 * need a real server: `LIVE_CLOUD=1`, `POSTGRES_SCHEMA_MUTATION_TEST=1` (it deletes its own fixture rows)
 * and `DATABASE_URL`, which the CI job `postgres-lifecycle` sets against a disposable container.
 */
import { PGlite } from "@electric-sql/pglite";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import { retentionActivationContractSuite } from "@storyshelf/core/test-helpers";
import { sql } from "drizzle-orm";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prepareBaselineReferences } from "./baseline-preparation.ts";
import { createBuildReferenceLifecycle } from "./build-reference-lifecycle.ts";
import { createPostgresDatabase } from "./index.ts";
import { createPgliteDatabase } from "./pglite.ts";
import { activateRetention, type RetentionActivation } from "./retention-activation.ts";
import { schema } from "./schema/index.ts";

const silent = createShelfLogger({ level: "silent" });
const now = "2026-01-01T00:00:00.000Z";
const LIVE =
  process.env["LIVE_CLOUD"] === "1" &&
  process.env["POSTGRES_SCHEMA_MUTATION_TEST"] === "1" &&
  process.env["DATABASE_URL"] !== undefined;
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

/** A promise and the means to settle it, for holding one side of a race. */
function deferred(): { promise: Promise<null>; resolve: () => void } {
  const { promise, resolve } = Promise.withResolvers<null>();
  return { promise, resolve: () => resolve(null) };
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
async function freshProject(adapter: DatabaseAdapter): Promise<void> {
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
function seeding(adapter: DatabaseAdapter) {
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

function baselineInsert(row: {
  id: string;
  storyId?: string;
  sourceBuildId?: string | null;
  snapshotId?: string | null;
}) {
  return {
    ...baselineRow,
    storyId: row.storyId ?? row.id,
    ...row,
    snapshotId: row.snapshotId === undefined ? "snap" : row.snapshotId,
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

retentionActivationContractSuite("Postgres (PGlite, one connection)", async (run) => {
  const { client, adapter } = await sharedPglite();
  await freshProject(adapter);
  const database = drizzlePglite(client, { schema });
  await run({
    lifecycle: createBuildReferenceLifecycle(database),
    prepare: async () => {
      const state: RetentionActivation = {};
      await activateRetention(database, state);
      return state.pause;
    },
    ...seeding(adapter),
  });
});

describe.skipIf(!LIVE)("real Postgres, one connection per party", () => {
  const url = process.env["DATABASE_URL"] ?? "";
  const clients = [postgres(url), postgres(url), postgres(url)] as const;
  afterAll(async () => {
    await Promise.all(clients.map(async (client) => await client.end()));
  });

  /** A fresh project on connection one; `database(n)` is Drizzle over connection n. */
  async function fresh() {
    const [one, two, three] = clients;
    const adapter = createPostgresDatabase({ client: one });
    await adapter.lifecycle?.setup({ config: {}, logger: silent });
    await freshProject(adapter);
    const database = (n: 0 | 1 | 2) => drizzlePostgres([one, two, three][n] ?? one, { schema });
    return { adapter, database };
  }

  retentionActivationContractSuite("Postgres (real server)", async (run) => {
    const { adapter, database } = await fresh();
    await run({
      lifecycle: createBuildReferenceLifecycle(database(1)),
      prepare: async () => {
        const state: RetentionActivation = {};
        await activateRetention(database(0), state);
        return state.pause;
      },
      ...seeding(adapter),
    });
  });

  it("resumes after a preparation that failed at its last step, leaving nothing behind", async () => {
    const { adapter, database } = await fresh();
    await seeding(adapter).seed.baseline({ id: "base", sourceBuildId: "one" });
    const lifecycle = createBuildReferenceLifecycle(database(1));
    const owner = { projectId: "p", type: "baseline", id: "base" } as const;

    await expect(
      prepareBaselineReferences(database(0), async () => {
        throw new Error("interrupted");
      }),
    ).rejects.toThrow("interrupted");

    // The pin and the generation it advanced rolled back with the transaction.
    expect(await lifecycle.referenceGeneration(owner)).toBe(0);
    expect(await lifecycle.claimDeletion("p", "one")).toBe("claimed");
    await adapter.all(sql`UPDATE builds SET retention_state = 'available' WHERE id = 'one'`);

    expect(await prepareBaselineReferences(database(0))).toEqual({
      protected: 1,
      unknown: 0,
      unavailable: 0,
    });
    expect(await lifecycle.claimDeletion("p", "one")).toBe("protected");
  });

  it("makes a fenced writer wait for preparation, then fail on the generation it advanced", async () => {
    const { adapter, database } = await fresh();
    await seeding(adapter).seed.baseline({ id: "base", sourceBuildId: "one" });
    const writer = createBuildReferenceLifecycle(database(1));
    const owner = { projectId: "p", type: "baseline", id: "base" } as const;
    const held = deferred();
    const atLastStep = deferred();

    // Preparation has pinned the baseline and holds its locks until `release`.
    const preparing = prepareBaselineReferences(database(0), async () => {
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
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(finished).toBe(false);

    held.resolve();
    await preparing;
    // The writer saw generation 0 before preparation; it now sees 1 and is rejected, not merged.
    expect(await outcome).toBe("ReferenceGenerationConflict");
    expect(await writer.referenceGeneration(owner)).toBe(1);
  });

  it("waits for a fenced writer already in flight, then reconciles with what it committed", async () => {
    const { adapter, database } = await fresh();
    await seeding(adapter).seed.baseline({ id: "base", sourceBuildId: "one" });
    const writer = createBuildReferenceLifecycle(database(1));
    const owner = { projectId: "p", type: "baseline", id: "base" } as const;
    const held = deferred();
    const writerHolds = deferred();

    // The writer holds the owner's fence and has not committed.
    const writing = writer.replaceFencedReferences(owner, 0, ["two"], async () => {
      writerHolds.resolve();
      await held.promise;
      return null;
    });
    await writerHolds.promise;
    let prepared = false;
    const preparing = prepareBaselineReferences(database(0)).then((result) => {
      prepared = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
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
    const { adapter, database } = await fresh();
    await seeding(adapter).seed.baseline({ id: "base", sourceBuildId: "one" });

    const [first, second] = await Promise.all([
      prepareBaselineReferences(database(0)),
      prepareBaselineReferences(database(1)),
    ]);

    expect(first).toEqual(second);
    const lifecycle = createBuildReferenceLifecycle(database(2));
    // One pin, advanced once: the second instance found it done.
    expect(
      await lifecycle.referenceGeneration({ projectId: "p", type: "baseline", id: "base" }),
    ).toBe(1);
  });

  it("does not let a deletion claim slip between the check and the pin", async () => {
    const { adapter, database } = await fresh();
    await seeding(adapter).seed.baseline({ id: "base", sourceBuildId: "one" });
    const claimer = createBuildReferenceLifecycle(database(1));

    const [claim] = await Promise.allSettled([
      claimer.claimDeletion("p", "one"),
      prepareBaselineReferences(database(0)).catch((): null => null),
    ]);

    // Whichever won, the outcome is consistent: a claimed build is never also pinned.
    const pins = await adapter.all<{ n: string }>(
      sql`SELECT COUNT(*)::text AS n FROM build_references WHERE build_id = 'one'`,
    );
    const claimed = claim.status === "fulfilled" && claim.value === "claimed";
    expect(Number(pins[0]?.n ?? 0) > 0).toBe(!claimed);
  });

  it("exposes the capability on the adapter after setup, and reports a pause when a source is tombstoned", async () => {
    const [one] = clients;
    const adapter = createPostgresDatabase({ client: one });
    // Empty the tables first (an earlier test may leave a tombstone), then boot.
    await adapter.lifecycle?.setup({ config: {}, logger: silent });
    await freshProject(adapter);
    await adapter.lifecycle?.setup({ config: {}, logger: silent });
    expect(adapter.buildReferenceLifecycle).toBeDefined();
    expect(adapter.retentionPause).toBeUndefined();

    await seeding(adapter).seed.baseline({ id: "base", sourceBuildId: "two" });
    await adapter.all(sql`UPDATE builds SET retention_state = 'deleting' WHERE id = 'two'`);
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
});

describe("PGlite never exposes the capability", () => {
  it("keeps the in-process stand-in fail-closed: one session proves no locking", async () => {
    const { adapter } = await sharedPglite();
    expect(adapter.buildReferenceLifecycle).toBeUndefined();
    expect(adapter.retentionPause).toBeUndefined();
  });
});
