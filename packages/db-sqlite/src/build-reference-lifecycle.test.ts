import type { BuildReferenceOwner, TxStore } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import { BaselineModel, BaselineTransferModel, SnapshotModel } from "@storyshelf/core/models";
import {
  buildReferenceContractSuite,
  makeStorage,
  retentionActivationContractSuite,
} from "@storyshelf/core/test-helpers";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import {
  createBuildReferenceLifecycle,
  prepareBaselineReferences,
  replaceFencedReferences,
} from "./build-reference-lifecycle.ts";
import { createSqliteDatabase } from "./index.ts";
import { activateRetention, type RetentionActivation } from "./retention-activation.ts";
import { schema } from "./schema/index.ts";

const now = "2026-01-01T00:00:00.000Z";
const owner = { projectId: "p", type: "baseline", id: "base" } as const;
const childPollMs = 10;
const childWaitMs = 15_000;

const baselineRow = {
  projectId: "p",
  storyId: "story",
  viewportName: "desktop",
  branch: "main",
  browser: "chromium",
  screenshotPath: "shot",
  snapshotId: "snap",
  createdAt: now,
  updatedAt: now,
};

/** Rows of `build_references`, optionally for one baseline, read through a separate connection. */
function referenceRows(path: string, ownerId?: string): number {
  const db = new DatabaseSync(path);
  try {
    const sql =
      ownerId === undefined
        ? "SELECT COUNT(*) FROM build_references"
        : "SELECT COUNT(*) FROM build_references WHERE owner_id = ?";
    const row = (ownerId === undefined ? db.prepare(sql).get() : db.prepare(sql).get(ownerId)) as
      | Record<string, number>
      | undefined;
    return Number(Object.values(row ?? { count: 0 })[0]);
  } finally {
    db.close();
  }
}

type Lifecycle = ReturnType<typeof createBuildReferenceLifecycle>;

/** Read the owner's generation, then write fenced: the shape every caller of the contract now uses. */
async function replaceFenced<T>(
  lifecycle: Lifecycle,
  target: BuildReferenceOwner,
  ids: readonly string[],
  write: (tx: TxStore) => Promise<T>,
): Promise<T> {
  const generation = await lifecycle.referenceGeneration(target);
  return (await lifecycle.replaceFencedReferences(target, generation, ids, write)).result as T;
}

/** A promise the test opens by hand. */
function gate(): { promise: Promise<void>; open: () => void } {
  const holder = { open: () => {} };
  const promise = new Promise<void>((resolve) => {
    holder.open = resolve;
  });
  return { promise, open: () => holder.open() };
}

/** Committed marker projects, read through a separate connection. */
function markerCount(path: string): number {
  const db = new DatabaseSync(path);
  try {
    const row = db.prepare("SELECT COUNT(*) AS n FROM projects WHERE name = 'marker'").get() as
      | { n: number }
      | undefined;
    return row?.n ?? 0;
  } finally {
    db.close();
  }
}

async function waitForPath(path: string): Promise<boolean> {
  const deadline = Date.now() + childWaitMs;
  while (!existsSync(path) && Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- poll for a separate process to reach its marker
    await delay(childPollMs);
  }
  return existsSync(path);
}

async function withDatabase(run: (path: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "storyshelf-build-reference-"));
  const path = join(dir, "test.sqlite");
  const db = createSqliteDatabase(path);
  try {
    await db.lifecycle?.setup({ config: {}, logger: createShelfLogger({ level: "silent" }) });
    await db.insert(schema.projects, {
      id: "p",
      name: "Project",
      slug: "p",
      createdAt: now,
      updatedAt: now,
    });
    for (const id of ["one", "two"]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- create the records before opening another connection
      await db.insert(schema.builds, {
        id,
        projectId: "p",
        gitSha: id,
        gitBranch: "main",
        createdAt: now,
        updatedAt: now,
      });
    }
    await run(path);
  } finally {
    await db.lifecycle?.teardown();
    rmSync(dir, { recursive: true, force: true });
  }
}

buildReferenceContractSuite("SQLite", async (run) => {
  await withDatabase(async (path) => {
    await run({
      first: createBuildReferenceLifecycle(path),
      second: createBuildReferenceLifecycle(path),
      owner,
      buildIds: ["one", "two"],
      marker: {
        write: async (tx) => {
          const id = randomUUID();
          await tx.insert(schema.projects, {
            id,
            name: "marker",
            slug: id,
            createdAt: now,
            updatedAt: now,
          });
        },
        count: async () => await Promise.resolve(markerCount(path)),
      },
    });
  });
});

retentionActivationContractSuite("SQLite", async (run) => {
  await withDatabase(async (path) => {
    const db = createSqliteDatabase(path);
    try {
      await run({
        lifecycle: createBuildReferenceLifecycle(path),
        // The adapter's own boot step, so the pause it reports is the one that ships.
        prepare: async () => {
          const state: RetentionActivation = {};
          await activateRetention(path, state);
          return state.pause;
        },
        seed: {
          baseline: async (row) => {
            await db.insert(schema.baselines, {
              ...baselineRow,
              storyId: row.storyId ?? row.id,
              ...row,
              snapshotId: row.snapshotId === undefined ? "snap" : row.snapshotId,
            });
          },
          snapshot: async (row) => {
            await db.insert(schema.snapshots, {
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
          foreignBuild: async (id) => {
            await db.insert(schema.projects, {
              id: "q",
              name: "Other",
              slug: "q",
              createdAt: now,
              updatedAt: now,
            });
            await db.insert(schema.builds, {
              id,
              projectId: "q",
              gitSha: id,
              gitBranch: "main",
              createdAt: now,
              updatedAt: now,
            });
          },
        },
        baselineSource: async (id) =>
          ((await db.get(schema.baselines, id))?.["sourceBuildId"] as string | null | undefined) ??
          null,
      });
    } finally {
      await db.lifecycle?.teardown();
    }
  });
});

async function startContendingClaim(path: string): Promise<PromiseLike<unknown[]>[]> {
  const script = `import('./src/build-reference-lifecycle.ts').then(async ({ createBuildReferenceLifecycle }) => {
    const { writeFileSync } = await import('node:fs');
    const result = await createBuildReferenceLifecycle(process.argv[1], () => writeFileSync(process.argv[1] + '.approval-blocked', 'blocked')).claimDeletion('p', 'two');
    writeFileSync(process.argv[1] + '.approval-result', result);
  }).catch(() => { process.exitCode = 1; });`;
  const child = spawn(process.execPath, ["--experimental-strip-types", "-e", script, path], {
    cwd: process.cwd(),
    stdio: "ignore",
  });
  const exited = once(child, "close");
  if (!(await waitForPath(`${path}.approval-blocked`))) {
    child.kill("SIGKILL");
    await exited;
    throw new Error("Deletion did not contend with approval");
  }
  return [exited];
}

describe("SQLite reference lifecycle primitive", () => {
  it("rolls back a killed preparation process and resumes preparation after restart", async () => {
    await withDatabase(async (path) => {
      const db = createSqliteDatabase(path);
      try {
        await db.insert(schema.baselines, {
          id: "base",
          projectId: "p",
          storyId: "story",
          viewportName: "desktop",
          branch: "main",
          browser: "chromium",
          screenshotPath: "shot",
          sourceBuildId: "one",
          createdAt: now,
          updatedAt: now,
        });
        const script = `import('./src/build-reference-lifecycle.ts').then(async ({ prepareBaselineReferences }) => {
          const { writeFileSync } = await import('node:fs');
          await prepareBaselineReferences(process.argv[1], async () => {
            writeFileSync(process.argv[1] + '.prepared', 'uncommitted');
            await new Promise(() => setInterval(() => {}, 1000));
          });
        }).catch((error) => { process.stderr.write(String(error)); process.exitCode = 1; });`;
        const child = spawn(process.execPath, ["--experimental-strip-types", "-e", script, path], {
          cwd: process.cwd(),
          stdio: "ignore",
        });
        const closed = once(child, "close");
        try {
          expect(await waitForPath(`${path}.prepared`)).toBe(true);
        } finally {
          child.kill("SIGKILL");
          await closed;
        }
        const lifecycle = createBuildReferenceLifecycle(path);
        expect(await lifecycle.referenceGeneration(owner)).toBe(0);
        expect(await prepareBaselineReferences(path)).toEqual({
          protected: 1,
          unknown: 0,
          unavailable: 0,
        });
        expect(await lifecycle.referenceGeneration(owner)).toBe(1);
        expect(await lifecycle.claimDeletion("p", "one")).toBe("protected");
      } finally {
        await db.lifecycle?.teardown();
      }
    });
  }, 30_000);
  it("loses no pin when a fenced writer races preparation of the same baseline", async () => {
    await withDatabase(async (path) => {
      const db = createSqliteDatabase(path);
      try {
        await db.insert(schema.baselines, { ...baselineRow, id: "base", sourceBuildId: "one" });
        const lifecycle = createBuildReferenceLifecycle(path);
        const generation = await lifecycle.referenceGeneration(owner);
        const holding = gate();
        const released = gate();
        // Preparation holds the write lock; the writer read generation 0 before it started.
        const preparing = prepareBaselineReferences(path, async () => {
          holding.open();
          await released.promise;
        });
        await holding.promise;
        const writer = lifecycle.replaceFencedReferences(
          owner,
          generation,
          ["two"],
          async () => null,
        );
        const outcome = writer.then(
          () => "admitted",
          (error: unknown) => error,
        );
        released.open();
        expect(await preparing).toEqual({ protected: 1, unknown: 0, unavailable: 0 });

        // The writer's fence is stale: it is rejected, and the pin preparation made is still there.
        expect(await outcome).toMatchObject({ message: "Stale reference generation" });
        expect(await lifecycle.claimDeletion("p", "one")).toBe("protected");
        expect(referenceRows(path, "base")).toBe(1);

        // Retried at the new generation, it replaces the pin: no pin is lost or doubled.
        await lifecycle.replaceFencedReferences(
          owner,
          await lifecycle.referenceGeneration(owner),
          ["two"],
          async () => null,
        );
        expect(await lifecycle.claimDeletion("p", "one")).toBe("claimed");
        expect(await lifecycle.claimDeletion("p", "two")).toBe("protected");
      } finally {
        await db.lifecycle?.teardown();
      }
    });
  });
  it("rolls back review on drift and atomically commits forced review with promotion", async () => {
    await withDatabase(async (path) => {
      const db = createSqliteDatabase(path);
      const lifecycle = createBuildReferenceLifecycle(path);
      Object.assign(db, { buildReferenceLifecycle: lifecycle });
      const { storage } = makeStorage();
      const base = {
        projectId: "p",
        storyId: "story",
        storyName: "Story",
        storyTitle: "Story",
        viewportName: "desktop",
        browser: "chromium",
        createdAt: now,
        updatedAt: now,
      };
      try {
        await storage.write("old.png", Buffer.from("old"));
        await storage.write("new.png", Buffer.from("new"));
        await db.insert(schema.snapshots, {
          ...base,
          id: "old",
          buildId: "one",
          screenshotPath: "old.png",
        });
        const model = new BaselineModel(db, undefined, storage);
        const baseline = await model.upsert("p", "story", "desktop", "main", "old", "old.png");
        await db.insert(schema.snapshots, {
          ...base,
          id: "new",
          buildId: "two",
          screenshotPath: "new.png",
          status: "changed",
          baselineId: baseline.id,
          baselineVersion: "stale",
        });
        const snapshot = await new SnapshotModel(db).get("new");
        if (!snapshot) throw new Error("missing snapshot");
        const approval = { snapshot, reviewedBy: null, force: false, branch: "main" };
        await expect(
          model.upsert("p", "story", "desktop", "main", "new", "new.png", undefined, { approval }),
        ).rejects.toThrow("Baseline changed after this diff");
        expect((await new SnapshotModel(db).get("new"))?.status).toBe("changed");
        expect((await model.getFor("p", "story", "desktop", "main"))?.sourceBuildId).toBe("one");
        const replace = lifecycle.replaceFencedReferences;
        let childExit: PromiseLike<unknown[]>[] = [];
        lifecycle.replaceFencedReferences = async (ref, generation, ids, write) =>
          await replace(ref, generation, ids, async (tx) => {
            const result = await write(tx);
            childExit = await startContendingClaim(path);
            return result;
          });
        await model.upsert("p", "story", "desktop", "main", "new", "new.png", undefined, {
          approval: { ...approval, force: true },
        });
        expect((await Promise.all(childExit))[0]?.[0]).toBe(0);
        expect(readFileSync(`${path}.approval-result`, "utf8")).toBe("protected");
        expect((await new SnapshotModel(db).get("new"))?.status).toBe("approved");
        expect((await model.getFor("p", "story", "desktop", "main"))?.sourceBuildId).toBe("two");
        expect(await lifecycle.claimDeletion("p", "two")).toBe("protected");
      } finally {
        await db.lifecycle?.teardown();
      }
    });
  }, 30_000);
  it("keeps a prepared source protected until both baseline owners are removed", async () => {
    await withDatabase(async (path) => {
      const db = createSqliteDatabase(path);
      const base = {
        projectId: "p",
        storyId: "story",
        viewportName: "desktop",
        branch: "main",
        browser: "chromium",
        screenshotPath: "shot",
        snapshotId: "snap",
        sourceBuildId: "one",
        createdAt: now,
        updatedAt: now,
      };
      try {
        await db.insert(schema.baselines, { ...base, id: "main" });
        await db.insert(schema.baselines, { ...base, id: "feature", branch: "feature" });
        expect(await prepareBaselineReferences(path)).toEqual({
          protected: 2,
          unknown: 0,
          unavailable: 0,
        });
        const lifecycle = createBuildReferenceLifecycle(path);
        for (const id of ["main", "feature"]) {
          const ref = { type: "baseline" as const, id, projectId: "p" };
          // oxlint-disable-next-line no-await-in-loop -- verify protection after each owner is removed
          await lifecycle.replaceFencedReferences(ref, 1, [], async (tx) => {
            await tx.remove(schema.baselines, id);
          });
          // oxlint-disable-next-line no-await-in-loop -- the first owner must not release the second owner's pin
          expect(await lifecycle.claimDeletion("p", "one")).toBe(
            id === "main" ? "protected" : "claimed",
          );
        }
      } finally {
        await db.lifecycle?.teardown();
      }
    });
  });
  it("does not backfill a fingerprint onto a concurrently changed baseline", async () => {
    await withDatabase(async (path) => {
      const db = createSqliteDatabase(path);
      const lifecycle = createBuildReferenceLifecycle(path);
      Object.assign(db, { buildReferenceLifecycle: lifecycle });
      try {
        await db.insert(schema.baselines, {
          id: "base",
          projectId: "p",
          storyId: "story",
          viewportName: "desktop",
          branch: "main",
          browser: "chromium",
          screenshotPath: "old",
          snapshotId: "snap",
          sourceBuildId: "one",
          createdAt: now,
          updatedAt: now,
        });
        const model = new BaselineModel(db);
        const original = await model.getFor("p", "story", "desktop", "main");
        if (!original) throw new Error("Missing baseline");
        await db.update(schema.baselines, "base", {
          screenshotPath: "new",
          updatedAt: "2026-01-02T00:00:00.000Z",
        });
        await expect(model.backfillFingerprint(original, "hash", "fingerprint")).rejects.toThrow(
          "Baseline changed during fingerprint backfill",
        );
        expect((await model.getFor("p", "story", "desktop", "main"))?.fingerprint).toBeNull();
        expect(await lifecycle.referenceGeneration(owner)).toBe(0);
      } finally {
        await db.lifecycle?.teardown();
      }
    });
  });
  it("fences stale releases across independent SQLite connections", async () => {
    await withDatabase(async (path) => {
      const first = await replaceFencedReferences(path, owner, 0, ["one"], async () => "first");
      expect(first.generation).toBe(1);
      const second = await replaceFencedReferences(path, owner, 1, ["two"], async () => "second");
      expect(second.generation).toBe(2);
      await expect(
        replaceFencedReferences(path, owner, 1, [], async () => "stale"),
      ).rejects.toThrow("Stale reference generation");
      expect(await createBuildReferenceLifecycle(path).claimDeletion("p", "two")).toBe("protected");
      expect(
        (await replaceFencedReferences(path, owner, 2, [], async () => "release")).generation,
      ).toBe(3);
      await expect(
        replaceFencedReferences(path, owner, 2, [], async () => "repeat"),
      ).rejects.toThrow("Stale reference generation");
      expect(await createBuildReferenceLifecycle(path).claimDeletion("p", "two")).toBe("claimed");
    });
  });
  it("commits baseline promotions together with their source references", async () => {
    await withDatabase(async (path) => {
      const db = createSqliteDatabase(path);
      const lifecycle = createBuildReferenceLifecycle(path);
      Object.assign(db, { buildReferenceLifecycle: lifecycle });
      const { storage } = makeStorage();
      const png = Buffer.from([1, 2, 3]);
      await storage.write("one.png", png);
      await storage.write("two.png", png);
      const base = {
        projectId: "p",
        storyId: "story",
        storyName: "Story",
        storyTitle: "Story",
        viewportName: "desktop",
        browser: "chromium",
        createdAt: now,
        updatedAt: now,
      };
      try {
        await db.insert(schema.snapshots, {
          ...base,
          id: "snap-one",
          buildId: "one",
          screenshotPath: "one.png",
        });
        await db.insert(schema.snapshots, {
          ...base,
          id: "snap-two",
          buildId: "two",
          screenshotPath: "two.png",
        });
        const model = new BaselineModel(db, undefined, storage);
        const created = await model.upsert("p", "story", "desktop", "main", "snap-one", "one.png");
        expect(created.sourceBuildId).toBe("one");
        expect(await lifecycle.claimDeletion("p", "one")).toBe("protected");
        const updated = await model.upsert("p", "story", "desktop", "main", "snap-two", "two.png");
        expect(updated.id).toBe(created.id);
        expect(updated.sourceBuildId).toBe("two");
        expect(await lifecycle.claimDeletion("p", "one")).toBe("claimed");
        expect(await lifecycle.claimDeletion("p", "two")).toBe("protected");
      } finally {
        await db.lifecycle?.teardown();
      }
    });
  });
  it("releases a source only after the last baseline owner is removed", async () => {
    await withDatabase(async (path) => {
      const db = createSqliteDatabase(path);
      const lifecycle = createBuildReferenceLifecycle(path);
      Object.assign(db, { buildReferenceLifecycle: lifecycle });
      const { storage } = makeStorage();
      await storage.write("shot.png", Buffer.from([1, 2, 3]));
      try {
        await db.insert(schema.snapshots, {
          id: "snap",
          projectId: "p",
          buildId: "one",
          storyId: "story",
          storyName: "Story",
          storyTitle: "Story",
          viewportName: "desktop",
          browser: "chromium",
          screenshotPath: "shot.png",
          createdAt: now,
          updatedAt: now,
        });
        const model = new BaselineModel(db, undefined, storage);
        await model.upsert("p", "story", "desktop", "main", "snap", "shot.png");
        await model.upsert("p", "story", "desktop", "feature", "snap", "shot.png");
        expect(await model.removeForBranch("p", "feature")).toBe(1);
        expect(await lifecycle.claimDeletion("p", "one")).toBe("protected");
        expect(await model.removeForBranch("p", "main")).toBe(1);
        expect(await lifecycle.claimDeletion("p", "one")).toBe("claimed");
      } finally {
        await db.lifecycle?.teardown();
      }
    });
  });
  it("atomically releases the prior source when an archive replaces a baseline", async () => {
    await withDatabase(async (path) => {
      const db = createSqliteDatabase(path);
      const lifecycle = createBuildReferenceLifecycle(path);
      Object.assign(db, { buildReferenceLifecycle: lifecycle });
      const { storage } = makeStorage();
      await storage.write("shot.png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      try {
        await db.insert(schema.snapshots, {
          id: "snap",
          projectId: "p",
          buildId: "one",
          storyId: "story",
          storyName: "Story",
          storyTitle: "Story",
          viewportName: "desktop",
          browser: "chromium",
          screenshotPath: "shot.png",
          createdAt: now,
          updatedAt: now,
        });
        const model = new BaselineModel(db, undefined, storage);
        await model.upsert("p", "story", "desktop", "main", "snap", "shot.png");
        const transfer = new BaselineTransferModel(db, storage);
        const chunks: Buffer[] = [];
        for await (const chunk of await transfer.export("p")) chunks.push(chunk);
        expect((await transfer.import("p", Buffer.concat(chunks))).updated).toBe(1);
        expect((await model.getFor("p", "story", "desktop", "main"))?.sourceBuildId).toBeNull();
        expect(await lifecycle.claimDeletion("p", "one")).toBe("claimed");
      } finally {
        await db.lifecycle?.teardown();
      }
    });
  });
  it("does not block the event loop when two connections compete in one process", async () => {
    await withDatabase(async (path) => {
      const first = createBuildReferenceLifecycle(path);
      const second = createBuildReferenceLifecycle(path);
      const entered = Promise.withResolvers<boolean>();
      const release = Promise.withResolvers<boolean>();
      const admission = replaceFenced(first, owner, ["one"], async () => {
        entered.resolve(true);
        await release.promise;
      });
      await entered.promise;
      const deletion = second.claimDeletion("p", "one");
      await delay(30);
      release.resolve(true);
      await admission;
      expect(await deletion).toBe("protected");
    });
  });
  it("serializes a deletion claim against an in-flight admission in another process", async () => {
    await withDatabase(async (path) => {
      const lifecycle = createBuildReferenceLifecycle(path);
      let child: ReturnType<typeof spawn> | undefined;
      let errors = "";
      let exited: Promise<unknown[]> | undefined;
      await replaceFenced(lifecycle, owner, ["one"], async () => {
        const script = `import('./src/build-reference-lifecycle.ts').then(async ({ createBuildReferenceLifecycle }) => {
          const { writeFileSync } = await import('node:fs');
          const result = await createBuildReferenceLifecycle(process.argv[1], () => writeFileSync(process.argv[1] + '.ready', 'blocked')).claimDeletion('p', 'one');
          await import('node:fs').then(({ writeFileSync }) => writeFileSync(process.argv[1] + '.result', result));
        }).catch((error) => { process.stderr.write(String(error)); process.exitCode = 1; });`;
        child = spawn(process.execPath, ["--experimental-strip-types", "-e", script, path], {
          cwd: process.cwd(),
          stdio: ["ignore", "pipe", "pipe"],
        });
        exited = once(child, "close");
        child.stderr!.on("data", (chunk: Buffer) => {
          errors += chunk.toString();
        });
        if (!(await waitForPath(`${path}.ready`))) throw new Error(errors || "child did not start");
      });
      if (!child || !exited) throw new Error("child did not start");
      const [code] = await exited;
      expect(code).toBe(0);
      expect(readFileSync(`${path}.result`, "utf8")).toBe("protected");
    });
  }, 30_000);
  it("rejects missing and cross-project builds without dropping existing references", async () => {
    await withDatabase(async (path) => {
      const lifecycle = createBuildReferenceLifecycle(path);
      await replaceFenced(lifecycle, owner, ["one"], async () => await Promise.resolve());
      await expect(
        replaceFenced(lifecycle, owner, ["missing"], async () => await Promise.resolve()),
      ).rejects.toThrow("unavailable");
      expect(await lifecycle.claimDeletion("p", "one")).toBe("protected");
      await expect(
        replaceFenced(
          lifecycle,
          { ...owner, projectId: "other" },
          ["one"],
          async () => await Promise.resolve(),
        ),
      ).rejects.toThrow("unavailable");
    });
  });
});
