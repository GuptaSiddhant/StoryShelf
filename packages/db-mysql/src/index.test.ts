import { describe, expect, it, vi } from "vitest";
import { createMysqlDatabase } from "./index.ts";

function createRecordingPool() {
  const queries: string[] = [];
  const pool = {
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      return [[], []];
    }),
    execute: vi.fn(async (sql: string) => {
      queries.push(sql);
      return [[], []];
    }),
    end: vi.fn(async () => {}),
  };
  return { pool, queries };
}

describe("createMysqlDatabase", () => {
  it("throws without url/host or client", () => {
    expect(() => createMysqlDatabase({})).toThrow("provide");
  });

  it("runs migrations on setup via query", async () => {
    const { pool, queries } = createRecordingPool();
    const db = createMysqlDatabase({ client: pool as never });
    await db.lifecycle?.setup({ config: {} as never, logger: undefined as never });
    expect(queries.some((q) => q.includes("CREATE TABLE IF NOT EXISTS projects"))).toBe(true);
  });

  it("pings with SELECT 1", async () => {
    const { pool, queries } = createRecordingPool();
    const db = createMysqlDatabase({ client: pool as never });
    await db.lifecycle?.setup({ config: {} as never, logger: undefined as never });
    queries.length = 0;
    await db.lifecycle?.health();
    expect(queries).toContain("SELECT 1");
  });
});
