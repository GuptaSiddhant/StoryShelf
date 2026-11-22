/**
 * Live Turso/libSQL test — strictly real cloud, no local file stub.
 *
 * Gated on `LIVE_CLOUD=1` plus `TURSO_DATABASE_URL`, so hermetic
 * `turbo test` never touches Turso. Migrations run in `setup` (same as the
 * hermetic suite); rows use a unique id/slug per run and are removed
 * afterwards, so parallel runs never collide.
 *
 * Required env when live:
 * - `TURSO_DATABASE_URL` — libSQL URL (`libsql://...turso.io` for cloud,
 *   or a `file:` URL for a local libSQL smoke run)
 * - `TURSO_AUTH_TOKEN` — auth token (omit for `file:` URLs).
 *
 * The database capture queue's multi-instance suite runs here too, plus the idle-probe check behind
 * the Turso metering question (ADR 0006, open questions): the poll probe must be an index search
 * that, on an idle queue, reads no rows. Turso bills rows read, so an idle probe should cost one
 * request and zero rows; the billed figure itself is only visible in the Turso dashboard.
 */
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import type { Project } from "@storyshelf/core/schema";
import { databaseQueueMultiInstanceSuite } from "@storyshelf/core/test-helpers";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "./schema/index.ts";
import { createTursoDatabase } from "./turso.ts";

const LIVE = process.env["LIVE_CLOUD"] === "1" && process.env["TURSO_DATABASE_URL"] !== undefined;
const silentLogger = createShelfLogger({ level: "silent" });

function liveUrl(): string {
  const url = process.env["TURSO_DATABASE_URL"];
  if (!url) {
    throw new Error("Live Turso test requires TURSO_DATABASE_URL.");
  }
  return url;
}

function liveAuthToken(): string | undefined {
  return process.env["TURSO_AUTH_TOKEN"];
}

function runId(): string {
  return `live-${randomUUID()}`;
}

describe.skipIf(!LIVE)("turso live (real libSQL, gated on LIVE_CLOUD=1)", () => {
  const id = runId();
  const slug = runId();
  let db: DatabaseAdapter;

  function activeDb(): DatabaseAdapter {
    if (!db) {
      throw new Error("Live Turso harness not initialized");
    }
    return db;
  }

  beforeAll(async () => {
    const authToken = liveAuthToken();
    db = authToken
      ? createTursoDatabase({ url: liveUrl(), authToken })
      : createTursoDatabase({ url: liveUrl() });
    await db.lifecycle?.setup({ config: {}, logger: silentLogger });
  });

  afterAll(async () => {
    const target = activeDb();
    await target.remove(schema.projects, id).catch(() => {});
    await target.lifecycle?.teardown();
  });

  it("migrates and round-trips a project", async () => {
    const target = activeDb();
    const now = new Date().toISOString();
    const inserted = (await target.insert(schema.projects, {
      id,
      name: "Live",
      slug,
      createdAt: now,
      updatedAt: now,
    })) as Project;
    expect(inserted.slug).toBe(slug);

    const found = (await target.get(schema.projects, id)) as Project | null;
    expect(found?.name).toBe("Live");

    const listed = await target.list(schema.projects);
    expect(listed.some((row) => (row as Project).id === id)).toBe(true);
  });

  it("updates and removes the project", async () => {
    const target = activeDb();
    await target.update(schema.projects, id, { name: "Live Renamed" });
    const renamed = (await target.get(schema.projects, id)) as Project | null;
    expect(renamed?.name).toBe("Live Renamed");

    await target.remove(schema.projects, id);
    expect(await target.get(schema.projects, id)).toBeNull();
  });
});

describe.skipIf(!LIVE)("turso live: database capture queue", () => {
  let db: DatabaseAdapter | undefined;

  function liveDb(): DatabaseAdapter {
    if (!db) {
      throw new Error("Live Turso harness not initialized");
    }
    return db;
  }

  beforeAll(async () => {
    const authToken = liveAuthToken();
    db = authToken
      ? createTursoDatabase({ url: liveUrl(), authToken })
      : createTursoDatabase({ url: liveUrl() });
    await db.lifecycle?.setup({ config: {}, logger: silentLogger });
  });

  afterAll(async () => {
    await db?.lifecycle?.teardown();
  });

  databaseQueueMultiInstanceSuite("Turso (live)", liveDb, { timeoutMs: 120_000 });

  it("probes through the poll index, sorting nothing", async () => {
    const plan = await liveDb().all<unknown>(sql`
      EXPLAIN QUERY PLAN
      SELECT * FROM capture_jobs
      WHERE kind = 'capture' AND visible_at <= '1970-01-01T00:00:00.000Z'
        AND status IN ('queued', 'running')
      ORDER BY visible_at ASC LIMIT 1`);
    const text = JSON.stringify(plan);
    expect(text).toMatch(/capture_jobs_poll_idx/u);
    expect(text).not.toMatch(/TEMP B-TREE/u);
  });
});
