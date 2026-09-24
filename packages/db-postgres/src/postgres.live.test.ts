/**
 * Live Postgres test — strictly real cloud, no mocked driver.
 *
 * Gated on `LIVE_CLOUD=1` plus `DATABASE_URL`, so hermetic `turbo test`
 * never touches Postgres. Migrations run in `setup`; rows use a unique
 * id/slug per run and are removed afterwards, so parallel runs never
 * collide. Works against any wire-compatible provider (self-hosted, RDS,
 * Cloud SQL, Supabase, Neon, Azure PG) — see the deployment guide for
 * per-provider TLS/pooling recipes.
 *
 * Required env when live:
 * - `DATABASE_URL` — connection string (`postgres://...`, `?sslmode=require`
 *   for managed providers; Supabase pooler needs `prepare: false`, which is
 *   a code option, not a URL flag — use a direct connection for live tests).
 */
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDatabase } from "./index.ts";
import { projects, type Project } from "./schema/index.ts";

const LIVE = process.env["LIVE_CLOUD"] === "1" && process.env["DATABASE_URL"] !== undefined;
const silentLogger = createShelfLogger({ level: "silent" });

function liveUrl(): string {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    throw new Error("Live Postgres test requires DATABASE_URL.");
  }
  return url;
}

function runId(): string {
  return `live-${randomUUID()}`;
}

describe.skipIf(!LIVE)("postgres live (real Postgres, gated on LIVE_CLOUD=1)", () => {
  const id = runId();
  const slug = runId();
  let db: DatabaseAdapter;

  function activeDb(): DatabaseAdapter {
    if (!db) {
      throw new Error("Live Postgres harness not initialized");
    }
    return db;
  }

  beforeAll(async () => {
    db = createPostgresDatabase({ url: liveUrl() });
    await db.lifecycle?.setup({ config: {}, logger: silentLogger });
  });

  afterAll(async () => {
    const target = activeDb();
    await target.remove(projects, id).catch(() => {});
    await target.lifecycle?.teardown();
  });

  it("migrates and round-trips a project", async () => {
    const target = activeDb();
    const now = new Date().toISOString();
    const inserted = (await target.insert(projects, {
      id,
      name: "Live",
      slug,
      createdAt: now,
      updatedAt: now,
    })) as Project;
    expect(inserted.slug).toBe(slug);

    const found = (await target.get(projects, id)) as Project | null;
    expect(found?.name).toBe("Live");

    const listed = await target.list(projects);
    expect(listed.some((row) => (row as Project).id === id)).toBe(true);
  });

  it("updates and removes the project", async () => {
    const target = activeDb();
    await target.update(projects, id, { name: "Live Renamed" });
    const renamed = (await target.get(projects, id)) as Project | null;
    expect(renamed?.name).toBe("Live Renamed");

    await target.remove(projects, id);
    expect(await target.get(projects, id)).toBeNull();
  });
});
