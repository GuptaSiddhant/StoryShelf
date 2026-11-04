import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import {
  CONTENT_GRACE_MS,
  Retention,
  collectUnreferencedContent,
  deleteClaimedBuild,
  type DeletionStep,
} from "@storyshelf/core/retention";
import { makeStorage } from "@storyshelf/core/test-helpers";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createBuildReferenceLifecycle } from "./build-reference-lifecycle.ts";
import { createSqliteDatabase } from "./index.ts";
import { rollbackQuietly } from "./lifecycle-transaction.ts";
import { schema } from "./schema/index.ts";

const old = "2026-01-01T00:00:00.000Z";
const hashOf = (text: string): string => createHash("sha256").update(text).digest("hex");
const SHARED = hashOf("shared");
const ONLY_ONE = hashOf("only one");
const ONLY_TWO = hashOf("only two");
const owner = { projectId: "p", type: "baseline", id: "base" } as const;
/** A clock past the content grace period. */
const afterGrace = (): number => Date.now() + CONTENT_GRACE_MS + 60_000;

interface Fixture {
  path: string;
  db: DatabaseAdapter;
  lifecycle: ReturnType<typeof createBuildReferenceLifecycle>;
  storage: ReturnType<typeof makeStorage>["storage"];
  objects: ReturnType<typeof makeStorage>["objects"];
  /** Rows of `content_uses` for the hash: how many are still unreleased, and how many exist. */
  uses(hash: string): { active: number; rows: number };
}

/** A project with two published builds sharing one file, on a real SQLite file. */
async function withFixture(run: (fixture: Fixture) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "storyshelf-build-deletion-"));
  const path = join(dir, "test.sqlite");
  const sqlite = createSqliteDatabase(path);
  try {
    await sqlite.lifecycle?.setup({ config: {}, logger: createShelfLogger({ level: "silent" }) });
    const lifecycle = createBuildReferenceLifecycle(path);
    const db: DatabaseAdapter = { ...sqlite, buildReferenceLifecycle: lifecycle };
    const { storage, objects } = makeStorage();
    await db.insert(schema.projects, {
      id: "p",
      name: "P",
      slug: "p",
      createdAt: old,
      updatedAt: old,
    });
    const one = await publish(db, storage, "one", { "index.html": "shared", "one.js": "only one" });
    const two = await publish(db, storage, "two", { "index.html": "shared", "two.js": "only two" });
    await lifecycle.recordContentUses("p", "one", one);
    await lifecycle.recordContentUses("p", "two", two);
    await run({ path, db, lifecycle, storage, objects, uses: (hash) => usesOf(path, hash) });
  } finally {
    await sqlite.lifecycle?.teardown();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Insert a build and store its manifest and files; resolves to the hashes its manifest names. */
async function publish(
  db: DatabaseAdapter,
  storage: Fixture["storage"],
  id: string,
  files: Record<string, string>,
): Promise<string[]> {
  await db.insert(schema.builds, {
    id,
    projectId: "p",
    gitSha: id,
    gitBranch: "main",
    status: "approved",
    createdAt: old,
    updatedAt: old,
  });
  const manifest = Object.fromEntries(
    Object.entries(files).map(([rel, text]) => [rel, hashOf(text)]),
  );
  await storage.write(
    `p/builds/${id}/storybook/manifest.json`,
    Buffer.from(JSON.stringify(manifest)),
  );
  for (const [rel, text] of Object.entries(files)) {
    // oxlint-disable-next-line no-await-in-loop -- a handful of fixture files, written in order
    await storage.write(`content/${hashOf(text)}`, Buffer.from(text));
    // oxlint-disable-next-line no-await-in-loop -- as above
    await storage.write(`p/builds/${id}/storybook/${rel}`, Buffer.from(text));
  }
  return Object.values(manifest);
}

function usesOf(path: string, hash: string): { active: number; rows: number } {
  const raw = new DatabaseSync(path);
  try {
    const row = raw
      .prepare(
        "SELECT COUNT(*) AS rows, COALESCE(SUM(released_at IS NULL), 0) AS active FROM content_uses WHERE content_hash = ?",
      )
      .get(hash) as unknown as { rows: number; active: number };
    return { active: row.active, rows: row.rows };
  } finally {
    raw.close();
  }
}

function deps(fixture: Fixture, afterStep?: (step: DeletionStep) => void) {
  return {
    db: fixture.db,
    lifecycle: fixture.lifecycle,
    storage: fixture.storage,
    ...(afterStep ? { afterStep } : {}),
  };
}

/** Throw once the named step has been recorded: the process "crashed" right after it. */
const crashAfter = (target: DeletionStep) => (step: DeletionStep) => {
  if (step === target) throw new Error(`crash after ${step}`);
};

async function claimed(fixture: Fixture, buildId: string) {
  expect(await fixture.lifecycle.claimDeletion("p", buildId)).toBe("claimed");
  const found = (await fixture.lifecycle.listDeleting("p")).find((b) => b.buildId === buildId);
  if (!found) throw new Error("claimed build is not listed");
  return found;
}

const buildExists = async (fixture: Fixture, id: string): Promise<boolean> =>
  (await fixture.db.get(schema.builds, id)) !== null;

describe("resumable build deletion on SQLite", () => {
  for (const step of ["content", "storage", "rows"] as const) {
    it(`resumes after a crash following the ${step} step, releasing each use once`, async () => {
      await withFixture(async (fixture) => {
        const first = await claimed(fixture, "one");
        await expect(deleteClaimedBuild(deps(fixture, crashAfter(step)), first)).rejects.toThrow(
          `crash after ${step}`,
        );

        // The tombstone survives the crash (the rows step removes the build, so only before it).
        const waiting = await fixture.lifecycle.listDeleting("p");
        expect(waiting.length).toBe(step === "rows" ? 0 : 1);
        for (const build of waiting) {
          // oxlint-disable-next-line no-await-in-loop -- at most one build waits
          const result = await deleteClaimedBuild(deps(fixture), build);
          expect(result.outcome).toBe("deleted");
        }

        expect(await buildExists(fixture, "one")).toBe(false);
        expect(await fixture.storage.list("p/builds/one/")).toEqual([]);
        expect(fixture.uses(SHARED)).toEqual({ active: 1, rows: 2 });
        expect(fixture.uses(ONLY_ONE)).toEqual({ active: 0, rows: 1 });
        expect(fixture.uses(ONLY_TWO)).toEqual({ active: 1, rows: 1 });
        expect(await fixture.lifecycle.listDeleting("p")).toEqual([]);
      });
    });
  }

  it("lets two concurrent cleaners finish one build once, with each use released once", async () => {
    await withFixture(async (fixture) => {
      const build = await claimed(fixture, "one");
      const other = { ...fixture, lifecycle: createBuildReferenceLifecycle(fixture.path) };
      const results = await Promise.all([
        deleteClaimedBuild(deps(fixture), build),
        deleteClaimedBuild(deps(other), build),
      ]);

      expect(results.map((result) => result.outcome).toSorted()).toEqual([
        "already-gone",
        "deleted",
      ]);
      expect(await buildExists(fixture, "one")).toBe(false);
      expect(fixture.uses(SHARED)).toEqual({ active: 1, rows: 2 });
      expect(fixture.uses(ONLY_ONE)).toEqual({ active: 0, rows: 1 });
    });
  });

  it("keeps shared content until both builds are gone and the grace period has passed", async () => {
    await withFixture(async (fixture) => {
      await deleteClaimedBuild(deps(fixture), await claimed(fixture, "one"));
      expect(await collectUnreferencedContent({ ...deps(fixture), now: afterGrace })).toBe(1);
      // Only the file nothing else used goes; build two still uses the shared one.
      expect(fixture.objects.has(`content/${ONLY_ONE}`)).toBe(false);
      expect(fixture.objects.has(`content/${SHARED}`)).toBe(true);

      await deleteClaimedBuild(deps(fixture), await claimed(fixture, "two"));
      expect(await collectUnreferencedContent(deps(fixture))).toBe(0);
      expect(fixture.objects.has(`content/${SHARED}`)).toBe(true);
      expect(await collectUnreferencedContent({ ...deps(fixture), now: afterGrace })).toBe(2);
      expect(fixture.objects.has(`content/${SHARED}`)).toBe(false);
      expect(fixture.uses(SHARED)).toEqual({ active: 0, rows: 0 });
    });
  });

  it("never collects a blob a live build's manifest still names, whatever the uses say", async () => {
    await withFixture(async (fixture) => {
      // Every use of the blob reads as released long ago while build two still serves the file.
      const raw = new DatabaseSync(fixture.path);
      raw
        .prepare("UPDATE content_uses SET released_at = ? WHERE content_hash = ?")
        .run(old, SHARED);
      raw.close();
      const removed = await collectUnreferencedContent({
        ...deps(fixture),
        now: afterGrace,
      });

      expect(removed).toBe(0);
      expect(fixture.objects.has(`content/${SHARED}`)).toBe(true);
      // The claim was given back, so the blob admits new uses again.
      await publish(fixture.db, fixture.storage, "late", { "index.html": "shared" });
      expect(await fixture.lifecycle.recordContentUses("p", "late", [SHARED])).toEqual([]);
    });
  });

  it("keeps the claim of a blob whose storage delete failed, so the next pass resumes it", async () => {
    await withFixture(async (fixture) => {
      await deleteClaimedBuild(deps(fixture), await claimed(fixture, "one"));
      const remove = fixture.storage.delete.bind(fixture.storage);
      fixture.storage.delete = async (path) => {
        if (path.startsWith("content/")) throw new Error("storage down");
        await remove(path);
      };

      expect(await collectUnreferencedContent({ ...deps(fixture), now: afterGrace })).toBe(0);
      expect(fixture.uses(ONLY_ONE).rows).toBe(1);
      // Still claimed: no build can start using a blob that is on its way out.
      await publish(fixture.db, fixture.storage, "late", { "index.html": "shared" });
      expect(await fixture.lifecycle.recordContentUses("p", "late", [ONLY_ONE])).toEqual([
        ONLY_ONE,
      ]);

      fixture.storage.delete = remove;
      // The claim is fresh, so it stays with its pass; once stale, a later pass resumes it.
      expect(await collectUnreferencedContent(deps(fixture))).toBe(0);
      expect(await collectUnreferencedContent({ ...deps(fixture), now: afterGrace })).toBe(1);
      expect(fixture.uses(ONLY_ONE).rows).toBe(0);
    });
  });

  it("purges through the capability and keeps a build a baseline still pins", async () => {
    await withFixture(async (fixture) => {
      const generation = await fixture.lifecycle.referenceGeneration(owner);
      await fixture.lifecycle.replaceFencedReferences(owner, generation, ["one"], async () => null);
      const retention = new Retention(fixture.db, fixture.storage, {
        builds: fixture.db.tables.builds,
        buildLabels: fixture.db.tables.buildLabels,
        baselines: fixture.db.tables.baselines,
      });
      const project = (await fixture.db.get(schema.projects, "p")) as never;

      const result = await retention.purge(project, { ttlDays: 1, keepLatestPerBranch: false });

      expect(result.removedBuilds).toBe(1);
      expect(await buildExists(fixture, "one")).toBe(true);
      expect(await buildExists(fixture, "two")).toBe(false);
      expect(await fixture.storage.list("p/builds/two/")).toEqual([]);
      expect(fixture.uses(SHARED).active).toBe(1);
    });
  });

  it("refuses a late writer that tries to pin a build already being deleted", async () => {
    await withFixture(async (fixture) => {
      await claimed(fixture, "one");
      const generation = await fixture.lifecycle.referenceGeneration(owner);

      await expect(
        fixture.lifecycle.replaceFencedReferences(owner, generation, ["one"], async () => null),
      ).rejects.toThrow("unavailable");
    });
  });

  it("finishes a build that an earlier run left half done, then reports nothing left", async () => {
    await withFixture(async (fixture) => {
      await expect(
        deleteClaimedBuild(deps(fixture, crashAfter("storage")), await claimed(fixture, "one")),
      ).rejects.toThrow("crash after storage");
      const retention = new Retention(fixture.db, fixture.storage, {
        builds: fixture.db.tables.builds,
        buildLabels: fixture.db.tables.buildLabels,
        baselines: fixture.db.tables.baselines,
      });
      const project = (await fixture.db.get(schema.projects, "p")) as never;

      const result = await retention.purge(project, { ttlDays: 1, keepLatestPerBranch: false });

      expect(await buildExists(fixture, "one")).toBe(false);
      expect(result.removedBuilds).toBe(2);
      expect(await fixture.lifecycle.listDeleting("p")).toEqual([]);
    });
  });
});

describe("recorded deletion steps", () => {
  it("rejects steps for a build that is not being deleted, or out of order", async () => {
    await withFixture(async ({ lifecycle }) => {
      expect(await lifecycle.releaseBuildContent("p", "one", [SHARED])).toBe("not-deleting");
      expect(await lifecycle.markStorageDeleted("p", "one")).toBe("not-deleting");
      expect(await lifecycle.completeDeletion("p", "one", async () => null)).toBe("not-deleting");

      await lifecycle.claimDeletion("p", "one");
      expect(await lifecycle.markStorageDeleted("p", "one")).toBe("out-of-order");
      expect(await lifecycle.completeDeletion("p", "one", async () => null)).toBe("out-of-order");
    });
  });

  it("releases every use of the build once, and repeats as a no-op", async () => {
    await withFixture(async (fixture) => {
      await fixture.lifecycle.claimDeletion("p", "one");
      const hashes = [SHARED, SHARED, ONLY_ONE, hashOf("unknown")];

      expect(await fixture.lifecycle.releaseBuildContent("p", "one", hashes)).toBe("done");
      expect(await fixture.lifecycle.releaseBuildContent("p", "one", hashes)).toBe("already-done");

      expect(fixture.uses(SHARED)).toEqual({ active: 1, rows: 2 });
      expect(fixture.uses(ONLY_ONE)).toEqual({ active: 0, rows: 1 });
      expect(fixture.uses(hashOf("unknown"))).toEqual({ active: 0, rows: 0 });
    });
  });

  it("releases a use the manifest does not list, so a build that failed early frees its blobs", async () => {
    await withFixture(async (fixture) => {
      await fixture.lifecycle.recordContentUses("p", "one", [hashOf("recorded only")]);
      await fixture.lifecycle.claimDeletion("p", "one");

      await fixture.lifecycle.releaseBuildContent("p", "one", []);

      expect(fixture.uses(hashOf("recorded only"))).toEqual({ active: 0, rows: 1 });
      expect(fixture.uses(SHARED).active).toBe(1);
    });
  });

  it("rolls the rows step back with its domain writes when they fail", async () => {
    await withFixture(async (fixture) => {
      const build = await claimed(fixture, "one");
      await fixture.lifecycle.releaseBuildContent("p", "one", [SHARED]);
      await fixture.lifecycle.markStorageDeleted("p", "one");

      await expect(
        fixture.lifecycle.completeDeletion("p", "one", async (tx) => {
          await tx.remove(schema.builds, "one");
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");

      expect(await buildExists(fixture, "one")).toBe(true);
      expect(await fixture.lifecycle.listDeleting("p")).toEqual([
        { ...build, contentReleased: true, storageDeleted: true },
      ]);
    });
  });
});

describe("rollbackQuietly", () => {
  it("does not throw when SQLite has no transaction to roll back", () => {
    const db = new DatabaseSync(":memory:");
    expect(() => rollbackQuietly(db)).not.toThrow();
    db.close();
  });
});

describe("content uses", () => {
  it("records one row per build and hash, however often and at however many paths", async () => {
    await withFixture(async (fixture) => {
      const hash = hashOf("fresh");
      expect(await fixture.lifecycle.recordContentUses("p", "one", [hash, hash])).toEqual([]);
      expect(await fixture.lifecycle.recordContentUses("p", "one", [hash])).toEqual([]);
      expect(await fixture.lifecycle.recordContentUses("p", "two", [hash])).toEqual([]);

      expect(fixture.uses(hash)).toEqual({ active: 2, rows: 2 });
    });
  });

  it("records nothing for a build that is being deleted, so a late publish cannot pin blobs", async () => {
    await withFixture(async (fixture) => {
      const hash = hashOf("late publish");
      await claimed(fixture, "one");

      expect(await fixture.lifecycle.recordContentUses("p", "one", [hash, hash])).toEqual([hash]);
      expect(fixture.uses(hash)).toEqual({ active: 0, rows: 0 });
    });
  });

  it("records nothing for a build that is gone or belongs to another project", async () => {
    await withFixture(async (fixture) => {
      const hash = hashOf("orphan");
      await deleteClaimedBuild(deps(fixture), await claimed(fixture, "one"));

      expect(await fixture.lifecycle.recordContentUses("p", "one", [hash])).toEqual([hash]);
      expect(await fixture.lifecycle.recordContentUses("other", "two", [hash])).toEqual([hash]);
      expect(await fixture.lifecycle.recordContentUses("p", "missing", [hash])).toEqual([hash]);
      expect(fixture.uses(hash)).toEqual({ active: 0, rows: 0 });
    });
  });

  it("ends a use racing a collection in exactly one outcome", async () => {
    await withFixture(async (fixture) => {
      await deleteClaimedBuild(deps(fixture), await claimed(fixture, "one"));
      const idleBefore = new Date(afterGrace()).toISOString();
      const stillLive = "2000-01-01T00:00:00.000Z";

      // The collector wins: the use is refused, nothing is written, and the content comes back.
      expect(await fixture.lifecycle.claimContent("pass", idleBefore, stillLive)).toEqual([
        ONLY_ONE,
      ]);
      expect(
        await fixture.lifecycle.recordContentUses("p", "two", [ONLY_ONE, hashOf("x")]),
      ).toEqual([ONLY_ONE]);
      expect(fixture.uses(hashOf("x"))).toEqual({ active: 0, rows: 0 });
      await fixture.lifecycle.finishContentCollection(ONLY_ONE, "pass");
      expect(await fixture.lifecycle.recordContentUses("p", "two", [ONLY_ONE])).toEqual([]);

      // The use wins: a blob with an unreleased use is not claimed.
      expect(await fixture.lifecycle.claimContent("pass", idleBefore, stillLive)).toEqual([]);
    });
  });

  it("hands a blob to one collector only, and resumes a claim once it is stale", async () => {
    await withFixture(async (fixture) => {
      await deleteClaimedBuild(deps(fixture), await claimed(fixture, "one"));
      const idleBefore = new Date(afterGrace()).toISOString();
      const live = "2000-01-01T00:00:00.000Z";
      const stale = "9999-12-31T00:00:00.000Z";
      const other = createBuildReferenceLifecycle(fixture.path);

      const results = await Promise.all([
        fixture.lifecycle.claimContent("pass-1", idleBefore, live),
        other.claimContent("pass-2", idleBefore, live),
      ]);

      // Exactly one collector got it; the other must not touch a blob its peer is deleting.
      expect(results.flat()).toEqual([ONLY_ONE]);
      // The claimer "crashed": a later pass resumes the stale claim, once.
      expect(await other.claimContent("pass-3", idleBefore, stale)).toEqual([ONLY_ONE]);
      await fixture.lifecycle.finishContentCollection(ONLY_ONE, "pass-3");
      expect(await other.claimContent("pass-4", idleBefore, stale)).toEqual([]);
    });
  });

  it("skips the delete of a collector whose claim was taken over, and leaves the blob and its rows", async () => {
    await withFixture(async (fixture) => {
      await deleteClaimedBuild(deps(fixture), await claimed(fixture, "one"));
      const stale = "9999-12-31T00:00:00.000Z";
      const idleBefore = new Date(afterGrace()).toISOString();
      // A hung pass claimed the blob; a later pass took the stale claim over.
      expect(
        await fixture.lifecycle.claimContent("hung", idleBefore, "2000-01-01T00:00:00.000Z"),
      ).toEqual([ONLY_ONE]);
      expect(await fixture.lifecycle.claimContent("successor", idleBefore, stale)).toEqual([
        ONLY_ONE,
      ]);

      // The hung pass wakes up still believing it claimed the blob (its claim call returned it
      // long ago), but its token no longer holds the claim, so it deletes nothing.
      const lifecycle = { ...fixture.lifecycle, claimContent: async () => [ONLY_ONE] };
      const removed = await collectUnreferencedContent({ ...deps(fixture), lifecycle });
      expect(removed).toBe(0);
      expect(fixture.objects.has(`content/${ONLY_ONE}`)).toBe(true);
      expect(fixture.uses(ONLY_ONE).rows).toBe(1);
      expect(await fixture.lifecycle.holdsContentClaim(ONLY_ONE, "successor")).toBe(true);
    });
  });
});
