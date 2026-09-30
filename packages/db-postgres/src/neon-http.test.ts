import type { NeonQueryFunction } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { createNeonHttpDatabase } from "./neon-http.ts";

/** Recording stand-in for a `neon()` query function. */
function createRecordingSql() {
  const queries: string[] = [];
  const sql = Object.assign(
    vi.fn(async () => [] as unknown[]),
    {
      query: vi.fn(async (text: string) => {
        queries.push(text);
        return [] as unknown[];
      }),
    },
  );
  return { sql: sql as unknown as NeonQueryFunction<false, false>, queries };
}

describe("createNeonHttpDatabase", () => {
  it("throws without url or client", () => {
    expect(() => createNeonHttpDatabase({})).toThrow("provide `url`");
  });

  it("runs the shared DDL on setup", async () => {
    const { sql, queries } = createRecordingSql();
    const db = createNeonHttpDatabase({ client: sql });
    await db.lifecycle?.setup({ config: {}, logger: undefined as never });
    expect(queries.some((q) => q.includes("CREATE TABLE IF NOT EXISTS projects"))).toBe(true);
    expect(queries.some((q) => q.includes("CREATE TABLE IF NOT EXISTS capture_attempts"))).toBe(
      true,
    );
  });

  it("pings with SELECT 1", async () => {
    const { sql, queries } = createRecordingSql();
    const db = createNeonHttpDatabase({ client: sql });
    await db.lifecycle?.setup({ config: {}, logger: undefined as never });
    queries.length = 0;
    const health = await db.lifecycle?.health();
    expect(health).toEqual({ ok: true });
    expect(queries).toEqual(["SELECT 1"]);
  });

  it("teardown is a no-op (fetch holds no connections)", async () => {
    const { sql } = createRecordingSql();
    const db = createNeonHttpDatabase({ client: sql });
    await db.lifecycle?.teardown();
    expect(db.metadata.kind).toBe("neon-http");
  });
});
