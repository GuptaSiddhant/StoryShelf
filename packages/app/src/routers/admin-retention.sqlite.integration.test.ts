import { createShelfLogger } from "@storyshelf/core/logger";
import { makeStorage } from "@storyshelf/core/test-helpers";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vite-plus/test";
import { createShelfApp } from "../index.tsx";
import { stubRunner } from "../test-runner.ts";

const OLD = "2025-01-01T00:00:00.000Z";
const SHARED = "a".repeat(64);
const ONLY_EXPIRED = "b".repeat(64);

/** A real SQLite file with `testing`: three old builds on `main`, one of them pinned by a baseline. */
async function withDeployment(
  run: (ctx: {
    request: () => Promise<Response>;
    db: ReturnType<typeof createSqliteDatabase>;
    objects: ReturnType<typeof makeStorage>["objects"];
    path: string;
  }) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "storyshelf-admin-retention-"));
  const path = join(dir, "shelf.sqlite");
  const db = createSqliteDatabase(path);
  let app: ReturnType<typeof createShelfApp> | undefined;
  try {
    await db.lifecycle?.setup({ config: {}, logger: createShelfLogger({ level: "silent" }) });
    const { storage, objects } = makeStorage();
    await db.insert(db.tables.projects, {
      id: "p",
      name: "P",
      slug: "p",
      gitDefaultBranch: "main",
      createdAt: OLD,
      updatedAt: OLD,
    });
    // All on `main`: the purge keeps the branch's newest build, so "latest" shields neither of the
    // two older ones; "pinned" is kept by its baseline alone.
    for (const [id, hashes, updatedAt] of [
      ["expired", [SHARED, ONLY_EXPIRED], OLD],
      ["pinned", [SHARED], OLD],
      ["latest", [SHARED], "2025-01-02T00:00:00.000Z"],
    ] as const) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- three builds, in order
      await db.insert(db.tables.builds, {
        id,
        projectId: "p",
        gitSha: id,
        gitBranch: "main",
        status: "approved",
        createdAt: OLD,
        updatedAt,
      });
      const manifest = Object.fromEntries(hashes.map((hash, index) => [`f${index}.js`, hash]));
      objects.set(`p/builds/${id}/storybook/manifest.json`, Buffer.from(JSON.stringify(manifest)));
      for (const hash of hashes) objects.set(`content/${hash}`, Buffer.from(hash));
      // oxlint-disable-next-line eslint/no-await-in-loop -- three builds, in order
      await db.buildReferenceLifecycle?.recordContentUses("p", id, hashes);
    }
    // The baseline that pins it: preparation releases a pin whose baseline records no source.
    await db.insert(db.tables.baselines, {
      id: "base",
      projectId: "p",
      storyId: "story",
      viewportName: "desktop",
      branch: "main",
      browser: "chromium",
      screenshotPath: "shot",
      sourceBuildId: "pinned",
      createdAt: OLD,
      updatedAt: OLD,
    });
    const lifecycle = db.buildReferenceLifecycle;
    const owner = { type: "baseline" as const, projectId: "p", id: "base" };
    await lifecycle?.replaceFencedReferences(owner, 0, ["pinned"], async () => null);
    app = createShelfApp({
      database: db,
      storage,
      testing: { runner: stubRunner() },
      logger: createShelfLogger({ level: "silent" }),
    });
    const shelf = app;
    const request = async (): Promise<Response> =>
      await shelf.request("/api/v1/admin/purge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ttlDays: 1 }),
      });
    await run({ request, db, objects, path });
  } finally {
    // The app's timer and job consumer stop before the database they use is closed.
    await app?.lifecycle.teardown();
    await db.lifecycle?.teardown();
    rmSync(dir, { recursive: true, force: true });
  }
}

function usesOf(path: string, hash: string): { rows: number; active: number } {
  const raw = new DatabaseSync(path, { returnArrays: true });
  try {
    const row = raw
      .prepare(
        "SELECT COUNT(*), COALESCE(SUM(released_at IS NULL), 0) FROM content_uses WHERE content_hash = ?",
      )
      .get(hash) as unknown as [number, number];
    return { rows: row[0], active: row[1] };
  } finally {
    raw.close();
  }
}

describe("admin purge on a SQLite deployment with testing", () => {
  it("purges an expired, unpinned build end to end and keeps the pinned one", async () => {
    await withDeployment(async ({ request, db, objects, path }) => {
      const response = await request();

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ removedBuilds: 1, protected: 1, resumed: 0 });
      expect(await db.get(db.tables.builds, "expired")).toBeNull();
      expect(await db.get(db.tables.builds, "pinned")).not.toBeNull();
      expect([...objects.keys()].filter((key) => key.startsWith("p/builds/expired/"))).toEqual([]);
      expect(objects.has("p/builds/pinned/storybook/manifest.json")).toBe(true);
      // Its content use is released (kept for the grace period); the pinned build's use is not.
      expect(usesOf(path, ONLY_EXPIRED)).toEqual({ rows: 1, active: 0 });
      expect(usesOf(path, SHARED)).toEqual({ rows: 3, active: 2 });
    });
  });

  it("finishes a build an earlier run claimed and reports it as resumed", async () => {
    await withDeployment(async ({ request, db }) => {
      expect(await db.buildReferenceLifecycle?.claimDeletion("p", "expired")).toBe("claimed");

      const response = await request();

      expect(await response.json()).toMatchObject({ removedBuilds: 1, protected: 1, resumed: 1 });
      expect(await db.get(db.tables.builds, "expired")).toBeNull();
    });
  });
});
