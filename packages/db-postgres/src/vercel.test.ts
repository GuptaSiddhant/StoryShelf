import type { VercelClient } from "@vercel/postgres";
import { describe, expect, it, vi } from "vitest";
import { createVercelDatabase } from "./vercel.ts";

function createRecordingClient() {
  const queries: string[] = [];
  const client = {
    query: vi.fn(async (text: string) => {
      queries.push(text);
      return { rows: [] };
    }),
  } as unknown as VercelClient;
  return { client, queries };
}

describe("createVercelDatabase", () => {
  it("runs the shared DDL on setup with the default sql client", async () => {
    const { client, queries } = createRecordingClient();
    const db = createVercelDatabase({ client });
    await db.lifecycle?.setup({ config: {}, logger: undefined as never });
    expect(queries.some((q) => q.includes("CREATE TABLE IF NOT EXISTS projects"))).toBe(true);
    expect(queries.some((q) => q.includes("CREATE TABLE IF NOT EXISTS capture_attempts"))).toBe(
      true,
    );
  });

  it("pings with SELECT 1", async () => {
    const { client, queries } = createRecordingClient();
    const db = createVercelDatabase({ client });
    await db.lifecycle?.setup({ config: {}, logger: undefined as never });
    queries.length = 0;
    const health = await db.lifecycle?.health();
    expect(health).toEqual({ ok: true });
    expect(queries).toEqual(["SELECT 1"]);
  });

  it("teardown is a no-op (platform owns the connection)", async () => {
    const { client } = createRecordingClient();
    const db = createVercelDatabase({ client });
    await db.lifecycle?.teardown();
    expect(db.metadata.kind).toBe("vercel");
  });
});
