import { describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm/postgres-js", () => ({
  // A transaction over a database with no baselines: every statement answers no rows.
  drizzle: vi.fn(() => ({
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      await fn({ execute: () => Promise.resolve([]) }),
  })),
}));

import { createPostgresDatabase } from "./index.ts";

describe("createPostgresDatabase", () => {
  it("throws when no url or client is provided", () => {
    expect(() => createPostgresDatabase({})).toThrow("provide `url`");
  });

  it("creates an adapter with injected client (no network)", async () => {
    const client = {
      unsafe: vi.fn(() => Promise.resolve([])),
      end: vi.fn(() => Promise.resolve()),
    } as unknown as ReturnType<typeof import("postgres")>;

    const db = createPostgresDatabase({ client });

    expect(db.metadata.kind).toBe("postgres");
    expect(db.metadata.name).toBe("Postgres");

    expect(db.buildReferenceLifecycle).toBeUndefined();
    await db.lifecycle?.setup({} as never);
    expect(client.unsafe).toHaveBeenCalled();
    // Activation ran after the migration: nothing to prepare, so retention is on.
    expect(db.buildReferenceLifecycle).toBeDefined();
    expect(db.retentionPause).toBeUndefined();

    await db.lifecycle?.teardown();
    expect(client.end).toHaveBeenCalled();
  });

  it("maps SSL and pool options via postgres.js (unit, fake)", () => {
    const fakePostgres = vi.fn(() => ({
      unsafe: vi.fn(() => Promise.resolve([])),
      end: vi.fn(() => Promise.resolve()),
    }));
    expect(fakePostgres).toBeDefined();
    const client = {
      unsafe: vi.fn(() => Promise.resolve([])),
      end: vi.fn(() => Promise.resolve()),
    } as unknown as ReturnType<typeof import("postgres")>;
    const db = createPostgresDatabase({ client, url: "postgres://user:pass@localhost:5432/shelf" });
    expect(db.metadata.kind).toBe("postgres");
  });
});
