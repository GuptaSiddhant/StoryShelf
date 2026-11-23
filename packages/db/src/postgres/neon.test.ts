import type { Pool } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { createNeonDatabase } from "./neon.ts";

/** Recording stand-in for a Neon pool (migrate/ping/close delegation only). */
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

describe("createNeonDatabase", () => {
  it("throws without url or client", () => {
    expect(() => createNeonDatabase({})).toThrow("provide `url`");
  });

  it("runs the shared DDL on setup", async () => {
    const pool = createRecordingPool();
    const db = createNeonDatabase({ client: pool as unknown as Pool });
    await db.lifecycle?.setup({ config: {}, logger: undefined as never });
    expect(pool.queries.some((q) => q.includes("CREATE TABLE IF NOT EXISTS projects"))).toBe(true);
    expect(
      pool.queries.some((q) => q.includes("CREATE TABLE IF NOT EXISTS capture_attempts")),
    ).toBe(true);
  });

  it("pings with SELECT 1", async () => {
    const pool = createRecordingPool();
    const db = createNeonDatabase({ client: pool as unknown as Pool });
    await db.lifecycle?.setup({ config: {}, logger: undefined as never });
    pool.queries.length = 0;
    const health = await db.lifecycle?.health();
    expect(health).toEqual({ ok: true });
    expect(pool.queries).toEqual(["SELECT 1"]);
  });

  it("teardown is a no-op for injected clients", async () => {
    const pool = createRecordingPool();
    const db = createNeonDatabase({ client: pool as unknown as Pool });
    await db.lifecycle?.teardown();
    expect(pool.isEnded()).toBe(false);
  });
});
