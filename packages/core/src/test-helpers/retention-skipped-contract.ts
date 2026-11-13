/**
 * Shared conformance tests for retention of skipped builds (ADR 0044 decision 8, ADR 0039): a
 * purge that deletes a source deletes the builds skipped from it through the same fenced
 * lifecycle, and a crash anywhere resumes without a skipped build outliving its source. Each case
 * runs against an adapter that has the lifecycle capability (SQLite file, PGlite).
 */
import { describe, expect, it } from "vitest";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { BuildModel } from "../models/build.ts";
import { purgeClaimedBuilds, Retention } from "../retention/purge.ts";
import { createTestBuild, createTestProject } from "./create-project.ts";
import { makeStorage } from "./fake-storage.ts";

const DAY = 86_400_000;

/** A database with the lifecycle capability attached; `run` owns its setup and teardown. */
export type RetentionSkippedRunner = (use: (db: DatabaseAdapter) => Promise<void>) => Promise<void>;

/** Seeds: an approved source, and `count` builds skipped from it, all older than the window. */
async function seed(db: DatabaseAdapter, skipped: number, ageDays = 60) {
  const project = await createTestProject(db, db.tables);
  const source = await createTestBuild(db, db.tables, project.id, { gitSha: "src" });
  const builds = new BuildModel(db, db.tables);
  const kids: string[] = [];
  for (let i = 0; i < skipped; i += 1) {
    // oxlint-disable-next-line no-await-in-loop -- seeded in order
    const kid = await builds.createSkipped({
      projectId: project.id,
      gitSha: `skip-${i}`,
      gitBranch: `branch-${i}`,
      sourceBuildId: source.id,
      changedFiles: [],
    });
    kids.push(kid.id);
  }
  await ageBuilds(db, [source.id, ...kids], ageDays);
  return { project, sourceId: source.id, kids, builds };
}

async function ageBuilds(db: DatabaseAdapter, ids: readonly string[], days: number): Promise<void> {
  const at = new Date(Date.now() - days * DAY).toISOString();
  for (const id of ids) {
    // oxlint-disable-next-line no-await-in-loop -- one row at a time
    await db.update(db.tables.builds, id, { updatedAt: at });
  }
}

async function expectGone(db: DatabaseAdapter, ids: readonly string[]): Promise<void> {
  const rows = await Promise.all(ids.map(async (id) => await db.get(db.tables.builds, id)));
  expect(rows.every((row) => row === null)).toBe(true);
}

function retention(db: DatabaseAdapter) {
  const { storage } = makeStorage();
  const tables = {
    builds: db.tables.builds,
    buildLabels: db.tables.buildLabels,
    baselines: db.tables.baselines,
  };
  return { storage, purger: new Retention(db, storage, tables) };
}

const options = { ttlDays: 30, keepLatestPerBranch: false } as const;

/** Run the skipped-build retention contract against an adapter with the lifecycle capability. */
export function retentionSkippedContractSuite(label: string, run: RetentionSkippedRunner): void {
  describe(`skipped-build retention contract: ${label}`, () => {
    it("removes the builds skipped from a purged source, in the same pass", async () => {
      await run(async (db) => {
        const { project, sourceId, kids } = await seed(db, 2);
        const result = await retention(db).purger.purge(project, options);
        expect(result.removedBuilds).toBe(3);
        await expectGone(db, [sourceId, ...kids]);
      });
    });

    it("leaves the source alone when only a skipped build is purged", async () => {
      await run(async (db) => {
        const { project, sourceId, kids } = await seed(db, 1);
        await ageBuilds(db, [sourceId], 1);
        const result = await retention(db).purger.purge(project, options);
        expect(result.removedBuilds).toBe(1);
        expect(await db.get(db.tables.builds, kids[0] as string)).toBeNull();
        expect(await db.get(db.tables.builds, sourceId)).not.toBeNull();
      });
    });

    it("keeps an old source while a skipped build from it is kept", async () => {
      await run(async (db) => {
        const { project, sourceId, kids } = await seed(db, 2);
        await ageBuilds(db, [kids[1] as string], 1);
        const result = await retention(db).purger.purge(project, options);
        expect(result.removedBuilds).toBe(1);
        expect(await db.get(db.tables.builds, kids[0] as string)).toBeNull();
        expect(await db.get(db.tables.builds, kids[1] as string)).not.toBeNull();
        expect(await db.get(db.tables.builds, sourceId)).not.toBeNull();
      });
    });

    it("finishes the cascade of a source an earlier run claimed and then crashed on", async () => {
      await run(async (db) => {
        const { project, sourceId, kids } = await seed(db, 2);
        const lifecycle = db.buildReferenceLifecycle;
        expect(await lifecycle?.claimDeletion(project.id, sourceId)).toBe("claimed");
        // The crash: the source is tombstoned, no skipped build has been claimed.
        const { storage } = retention(db);
        const result = await purgeClaimedBuilds(
          { db, storage, lifecycle: lifecycle as never },
          project.id,
          [],
        );
        expect(result.removedBuilds).toBe(3);
        await expectGone(db, [sourceId, ...kids]);
      });
    });

    it("keeps the source's rows until every skipped build's rows are gone, and resumes", async () => {
      await run(async (db) => {
        const { project, sourceId, kids } = await seed(db, 2);
        const lifecycle = db.buildReferenceLifecycle as never;
        const { storage } = retention(db);
        const crash = async (step: string, buildId: string) => {
          if (step === "storage" && buildId === kids[0]) throw new Error("crash");
        };
        const first = await purgeClaimedBuilds(
          { db, storage, lifecycle, afterStep: crash },
          project.id,
          [sourceId],
        );
        expect(first.removedBuilds).toBe(1);
        expect(await db.get(db.tables.builds, sourceId)).not.toBeNull();
        expect(await db.get(db.tables.builds, kids[0] as string)).not.toBeNull();
        const second = await purgeClaimedBuilds({ db, storage, lifecycle }, project.id, []);
        expect(second.removedBuilds).toBe(2);
        await expectGone(db, [sourceId, ...kids]);
      });
    });
  });
}
