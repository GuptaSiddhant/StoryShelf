import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { createPgDatabase } from "./pg.ts";

/** Recording stand-in for a `pg` pool (migrate/ping/close delegation only). */
function createRecordingPool() {
  const queries: string[] = [];
  let ended = false;
  const pool = {
    query: vi.fn(async (text: string) => {
      queries.push(text);
      return { rows: [] };
    }),
    end: vi.fn(async () => {
      ended = true;
    }),
    isEnded: () => ended,
    queries,
  };
  return pool;
}

describe("createPgDatabase", () => {
  it("throws without url or client", () => {
    expect(() => createPgDatabase({})).toThrow("provide `url`");
  });

  it("refuses a URL without a scheme, naming DATABASE_URL", () => {
    expect(() => createPgDatabase({ url: "localhost:5433/shelf" })).toThrow("DATABASE_URL");
  });

  it("ends a failed start with one line naming host, port and database, never the password", async () => {
    const db = createPgDatabase({
      url: "postgres://me:hunter2@127.0.0.1:1/shelf",
      connectionTimeoutMillis: 1000,
    });
    const failed = db.lifecycle?.setup({ config: {}, logger: undefined as never });
    await expect(failed).rejects.toThrow(/^cannot start the database at 127\.0\.0\.1:1\/shelf: /u);
    const message = await failed?.then(
      () => "",
      (error: unknown) => (error as Error).message,
    );
    expect(message).not.toMatch(/hunter2|me:/u);
    await db.lifecycle?.teardown();
  });

  it("runs the shared DDL on setup", async () => {
    const pool = createRecordingPool();
    const db = createPgDatabase({ client: pool as unknown as Pool });
    await db.lifecycle?.setup({ config: {}, logger: undefined as never });
    expect(pool.queries.some((q) => q.includes("CREATE TABLE IF NOT EXISTS projects"))).toBe(true);
    expect(
      pool.queries.some((q) => q.includes("CREATE TABLE IF NOT EXISTS capture_attempts")),
    ).toBe(true);
  });

  it("pings with SELECT 1", async () => {
    const pool = createRecordingPool();
    const db = createPgDatabase({ client: pool as unknown as Pool });
    await db.lifecycle?.setup({ config: {}, logger: undefined as never });
    pool.queries.length = 0;
    const health = await db.lifecycle?.health();
    expect(health).toEqual({ ok: true });
    expect(pool.queries).toEqual(["SELECT 1"]);
  });

  it("teardown is a no-op for injected clients", async () => {
    const pool = createRecordingPool();
    const db = createPgDatabase({ client: pool as unknown as Pool });
    await db.lifecycle?.teardown();
    expect(pool.isEnded()).toBe(false);
  });
});
