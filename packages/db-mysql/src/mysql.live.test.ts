/**
 * Live MySQL test — strictly real server, no mocked driver.
 *
 * Gated on `LIVE_CLOUD=1` plus `MYSQL_DATABASE_URL`, so hermetic `turbo test` never touches MySQL.
 * Migrations run in `setup`; rows use a unique id/slug per run and are removed afterwards, so
 * parallel runs never collide. Also runs the database capture queue's multi-instance suite
 * (ADR 0006 retires the external queue transports only once it passes on Postgres, MySQL and Turso).
 *
 * Required env when live:
 * - `MYSQL_SCHEMA_MUTATION_TEST=1` — opt in to destructive migration testing on a disposable database only.
 * - `MYSQL_DATABASE_URL` — connection string (`mysql://user:pass@host:3306/db`; PlanetScale/TiDB
 *   need TLS options, see the deployment guide).
 */
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import type { Project } from "@storyshelf/core/schema";
import { databaseQueueMultiInstanceSuite } from "@storyshelf/core/test-helpers";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMysqlDatabase } from "./index.ts";
import { schema } from "./schema/index.ts";

const LIVE = process.env["LIVE_CLOUD"] === "1" && process.env["MYSQL_DATABASE_URL"] !== undefined;
const silentLogger = createShelfLogger({ level: "silent" });

function liveUrl(): string {
  const url = process.env["MYSQL_DATABASE_URL"];
  if (!url) {
    throw new Error("Live MySQL test requires MYSQL_DATABASE_URL.");
  }
  return url;
}

describe.skipIf(!LIVE)("mysql live (real MySQL, gated on LIVE_CLOUD=1)", () => {
  const id = `live-${randomUUID()}`;
  const slug = `live-${randomUUID()}`;
  let db: DatabaseAdapter | undefined;

  function liveDb(): DatabaseAdapter {
    if (!db) {
      throw new Error("Live MySQL harness not initialized");
    }
    return db;
  }

  beforeAll(async () => {
    db = createMysqlDatabase({ url: liveUrl() });
    await db.lifecycle?.setup({ config: {}, logger: silentLogger });
  }, 60_000);

  afterAll(async () => {
    await db?.remove(schema.projects, id).catch(() => {});
    await db?.lifecycle?.teardown();
  });

  it.skipIf(process.env["MYSQL_SCHEMA_MUTATION_TEST"] !== "1")(
    "back-fills later columns on an existing schema",
    async () => {
      const upgradeId = `upgrade-${randomUUID()}`;
      const now = new Date().toISOString();
      await liveDb().insert(schema.projects, {
        id: upgradeId,
        name: "Upgrade",
        slug: upgradeId,
        createdAt: now,
        updatedAt: now,
      });
      for (const statement of [
        `ALTER TABLE projects
        DROP COLUMN run_a11y,
        DROP COLUMN run_tests,
        DROP COLUMN review_enabled,
        DROP COLUMN review_approvals,
        DROP COLUMN storybook_url_ttl_seconds`,
        "ALTER TABLE snapshots DROP COLUMN duration_ms, DROP COLUMN a11y_violations",
        "ALTER TABLE comments DROP COLUMN story_id",
        "ALTER TABLE notification_channels DROP COLUMN last_error, DROP COLUMN last_error_at",
      ]) {
        // oxlint-disable-next-line no-await-in-loop -- ordered schema rewrites
        await liveDb().all(sql.raw(statement));
      }

      await liveDb().lifecycle?.setup({ config: {}, logger: silentLogger });

      const project = (await liveDb().get(schema.projects, upgradeId)) as Project | null;
      expect(project?.runA11y).toBe(true);
      expect(project?.runTests).toBe(false);
      expect(project?.reviewEnabled).toBe(true);
      expect(project?.reviewApprovals).toBe(1);
      expect(project?.storybookUrlTtlSeconds ?? null).toBeNull();
      const columns = await liveDb().all<{ tableName: string; columnName: string }>(
        sql.raw(`
      SELECT table_name AS tableName, column_name AS columnName FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND (
          (table_name = 'snapshots' AND column_name IN ('duration_ms', 'a11y_violations'))
          OR (table_name = 'comments' AND column_name = 'story_id')
          OR (table_name = 'notification_channels' AND column_name IN ('last_error', 'last_error_at'))
        )
      ORDER BY table_name, column_name
    `),
      );
      expect(columns.map((row) => `${row.tableName}.${row.columnName}`)).toEqual([
        "comments.story_id",
        "notification_channels.last_error",
        "notification_channels.last_error_at",
        "snapshots.a11y_violations",
        "snapshots.duration_ms",
      ]);
      await liveDb().remove(schema.projects, upgradeId);
    },
  );

  it("migrates and round-trips a project", async () => {
    const now = new Date().toISOString();
    await liveDb().insert(schema.projects, {
      id,
      name: "Live",
      slug,
      createdAt: now,
      updatedAt: now,
    });
    const found = (await liveDb().get(schema.projects, id)) as Project | null;
    expect(found?.slug).toBe(slug);
    expect(found?.storybookUrlTtlSeconds ?? null).toBeNull();
    expect(found?.runA11y).toBe(true);
    await liveDb().update(schema.projects, id, { storybookUrlTtlSeconds: 14_400 });
    const updated = (await liveDb().get(schema.projects, id)) as Project | null;
    expect(updated?.storybookUrlTtlSeconds).toBe(14_400);
    await liveDb().remove(schema.projects, id);
    expect(await liveDb().get(schema.projects, id)).toBeNull();
  });

  databaseQueueMultiInstanceSuite("MySQL (live)", liveDb, { timeoutMs: 120_000 });
});
