import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import { ContentRefModel } from "@storyshelf/core/models";
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
  refCount(hash: string): Promise<number | undefined>;
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
    await seedRefs(db, [one, two]);
    const refs = new ContentRefModel(db);
    await run({
      path,
      db,
      lifecycle,
      storage,
      objects,
      refCount: async (hash) => (await refs.get(hash))?.refCount,
    });
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

/** One reference per build and distinct hash, as the upload routes are meant to record them. */
async function seedRefs(db: DatabaseAdapter, manifests: readonly string[][]): Promise<void> {
  const counts = new Map<string, number>();
  for (const hashes of manifests) {
    for (const hash of new Set(hashes)) counts.set(hash, (counts.get(hash) ?? 0) + 1);
  }
  for (const [hash, refCount] of counts) {
    // oxlint-disable-next-line no-await-in-loop -- a handful of fixture rows, inserted in order
    await db.insert(schema.contentRefs, { hash, refCount, lastSeenAt: old, createdAt: old });
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
    it(`resumes after a crash following the ${step} step, without a double decrement`, async () => {
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
        expect(await fixture.refCount(SHARED)).toBe(1);
        expect(await fixture.refCount(ONLY_ONE)).toBe(0);
        expect(await fixture.refCount(ONLY_TWO)).toBe(1);
        expect(await fixture.lifecycle.listDeleting("p")).toEqual([]);
      });
    });
  }

  it("lets two concurrent cleaners finish one build once, with correct counts", async () => {
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
      expect(await fixture.refCount(SHARED)).toBe(1);
      expect(await fixture.refCount(ONLY_ONE)).toBe(0);
    });
  });

  it("keeps shared content until both builds are gone and the grace period has passed", async () => {
    await withFixture(async (fixture) => {
      await deleteClaimedBuild(deps(fixture), await claimed(fixture, "one"));
      expect(await collectUnreferencedContent({ ...deps(fixture), now: afterGrace })).toBe(1);
      // Only the file nothing else used goes; the shared one is still counted by build two.
      expect(fixture.objects.has(`content/${ONLY_ONE}`)).toBe(false);
      expect(fixture.objects.has(`content/${SHARED}`)).toBe(true);

      await deleteClaimedBuild(deps(fixture), await claimed(fixture, "two"));
      expect(await collectUnreferencedContent(deps(fixture))).toBe(0);
      expect(fixture.objects.has(`content/${SHARED}`)).toBe(true);
      expect(await collectUnreferencedContent({ ...deps(fixture), now: afterGrace })).toBe(2);
      expect(fixture.objects.has(`content/${SHARED}`)).toBe(false);
      expect(await fixture.refCount(SHARED)).toBeUndefined();
    });
  });

  it("never collects a blob a live build's manifest still names, whatever the count says", async () => {
    await withFixture(async (fixture) => {
      // A count that drifted to 0 while build two still serves the file.
      const raw = new DatabaseSync(fixture.path);
      raw.prepare("UPDATE content_refs SET ref_count = 0 WHERE hash = ?").run(SHARED);
      raw.close();
      const removed = await collectUnreferencedContent({
        ...deps(fixture),
        now: afterGrace,
      });

      expect(removed).toBe(0);
      expect(fixture.objects.has(`content/${SHARED}`)).toBe(true);
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
      expect(await fixture.refCount(SHARED)).toBe(1);
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

  it("releases each distinct hash once, never below zero, and repeats as a no-op", async () => {
    await withFixture(async (fixture) => {
      await fixture.lifecycle.claimDeletion("p", "one");
      const hashes = [SHARED, SHARED, ONLY_ONE, hashOf("unknown")];

      expect(await fixture.lifecycle.releaseBuildContent("p", "one", hashes)).toBe("done");
      expect(await fixture.lifecycle.releaseBuildContent("p", "one", hashes)).toBe("already-done");

      expect(await fixture.refCount(SHARED)).toBe(1);
      expect(await fixture.refCount(ONLY_ONE)).toBe(0);
      expect(await fixture.refCount(hashOf("unknown"))).toBeUndefined();
    });
  });

  it("skips a hash whose release is already recorded for the build", async () => {
    await withFixture(async (fixture) => {
      await fixture.lifecycle.claimDeletion("p", "one");
      // A release recorded by an earlier pass whose step marker was never written.
      const raw = new DatabaseSync(fixture.path);
      raw
        .prepare(
          "INSERT INTO build_deletions (build_id, project_id, created_at, updated_at) VALUES ('one', 'p', ?, ?)",
        )
        .run(old, old);
      raw
        .prepare(
          "INSERT INTO build_content_releases (build_id, content_hash, released_at) VALUES ('one', ?, ?)",
        )
        .run(SHARED, old);
      raw.close();

      expect(await fixture.lifecycle.releaseBuildContent("p", "one", [SHARED, ONLY_ONE])).toBe(
        "done",
      );

      expect(await fixture.refCount(SHARED)).toBe(2);
      expect(await fixture.refCount(ONLY_ONE)).toBe(0);
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
