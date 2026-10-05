import { describe, expect, it, vi } from "vitest";
import { createPgliteDatabase } from "./pglite.ts";

function createRecordingPGlite() {
  const queries: string[] = [];
  let closed = false;
  const client = {
    query: vi.fn(async (text: string) => {
      queries.push(text);
      return { rows: [] };
    }),
    close: vi.fn(async () => {
      closed = true;
    }),
    isClosed: () => closed,
  };
  return { client: client as never, queries, isClosed: () => closed };
}

describe("createPgliteDatabase", () => {
  it("runs the shared DDL on setup", async () => {
    const { client, queries } = createRecordingPGlite();
    const db = createPgliteDatabase({ client });
    await db.lifecycle?.setup({ config: {}, logger: undefined as never });
    expect(queries.some((q) => q.includes("CREATE TABLE IF NOT EXISTS projects"))).toBe(true);
    expect(queries.some((q) => q.includes("CREATE TABLE IF NOT EXISTS capture_attempts"))).toBe(
      true,
    );
  });

  it("pings with SELECT 1", async () => {
    const { client, queries } = createRecordingPGlite();
    const db = createPgliteDatabase({ client });
    await db.lifecycle?.setup({ config: {}, logger: undefined as never });
    queries.length = 0;
    const health = await db.lifecycle?.health();
    expect(health).toEqual({ ok: true });
    expect(queries).toEqual(["SELECT 1"]);
  });

  it("teardown is a no-op for injected clients", async () => {
    const { client, isClosed } = createRecordingPGlite();
    const db = createPgliteDatabase({ client });
    await db.lifecycle?.teardown();
    expect(isClosed()).toBe(false);
  });
});
