/**
 * Live MySQL test — strictly real server, no mocked driver.
 *
 * Gated on `LIVE_CLOUD=1` plus `MYSQL_DATABASE_URL`, so hermetic `turbo test` never touches MySQL.
 * Migrations run in `setup`; rows use a unique id/slug per run and are removed afterwards, so
 * parallel runs never collide. Also runs the database capture queue's multi-instance suite
 * (ADR 0006 retires the external queue transports only once it passes on Postgres, MySQL and Turso).
 *
 * Required env when live:
 * - `MYSQL_DATABASE_URL` — connection string (`mysql://user:pass@host:3306/db`; PlanetScale/TiDB
 *   need TLS options, see the deployment guide).
 */
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import type { Project } from "@storyshelf/core/schema";
import { databaseQueueMultiInstanceSuite } from "@storyshelf/core/test-helpers";
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
  });

  afterAll(async () => {
    await db?.remove(schema.projects, id).catch(() => {});
    await db?.lifecycle?.teardown();
  });

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
