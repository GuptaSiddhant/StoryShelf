/** `push_subscriptions` (ADR 0048) arrives by expand step: an old database gains it, rows stay. */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { runMigrations } from "./migrate.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

function runnerFor(client: PGlite): (sql: string) => Promise<unknown[]> {
  return async (sql) => (await client.exec(sql)).flatMap((result) => result.rows);
}

describe("push_subscriptions on Postgres", () => {
  it("appears on an existing database, keeps its rows and survives a second run", async () => {
    const client = new PGlite();
    await client.exec(readFileSync(new URL("test-fixtures/pre-449.sql", import.meta.url), "utf8"));
    const count = async (table: string): Promise<number | undefined> =>
      (await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]?.n;
    const users = await count("users");
    await runMigrations(runnerFor(client));
    await runMigrations(runnerFor(client));
    expect(await count("users")).toBe(users);
    expect(await count("push_subscriptions")).toBe(0);
    await client.close();
  });
});
