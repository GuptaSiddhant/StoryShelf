import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import { backfillContentUses } from "@storyshelf/core/retention";
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

const now = "2026-01-01T00:00:00.000Z";
const hashOf = (text: string): string => createHash("sha256").update(text).digest("hex");
const SHARED = hashOf("shared");
const ONLY_ONE = hashOf("only one");

/** Rows of `content_uses`, as `buildId:hash` pairs. */
function useRows(path: string): string[] {
  const raw = new DatabaseSync(path);
  try {
    const rows = raw
      .prepare("SELECT build_id, content_hash FROM content_uses ORDER BY build_id, content_hash")
      .all() as unknown as { build_id: string; content_hash: string }[];
    return rows.map((row) => `${row.build_id}:${row.content_hash}`);
  } finally {
    raw.close();
  }
}

describe("content uses backfill on a real SQLite file", () => {
  it("gives builds published before content_uses their use rows, once, and skips a malformed hash", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storyshelf-backfill-"));
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
        createdAt: now,
        updatedAt: now,
      });
      const manifests: Record<string, Record<string, string>> = {
        one: { "index.html": SHARED, "one.js": ONLY_ONE },
        two: { "index.html": SHARED, "evil.js": "../p/builds/one/storybook/index.html" },
      };
      for (const [id, manifest] of Object.entries(manifests)) {
        // oxlint-disable-next-line no-await-in-loop -- two fixture builds
        await db.insert(schema.builds, {
          id,
          projectId: "p",
          gitSha: id,
          gitBranch: "main",
          status: "approved",
          createdAt: now,
          updatedAt: now,
        });
        objects.set(
          `p/builds/${id}/storybook/manifest.json`,
          Buffer.from(JSON.stringify(manifest)),
        );
      }
      expect(useRows(path)).toEqual([]);

      const first = await backfillContentUses({ db, storage, lifecycle });

      expect(first).toMatchObject({ done: true, builds: 2, uses: 3, skippedHashes: 1 });
      expect(useRows(path)).toEqual([
        `one:${[ONLY_ONE, SHARED].toSorted()[0]}`,
        `one:${[ONLY_ONE, SHARED].toSorted()[1]}`,
        `two:${SHARED}`,
      ]);

      expect(await backfillContentUses({ db, storage, lifecycle })).toMatchObject({
        done: true,
        builds: 0,
      });
      expect(useRows(path)).toHaveLength(3);
    } finally {
      await sqlite.lifecycle?.teardown();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
