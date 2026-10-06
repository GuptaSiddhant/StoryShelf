import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { Table } from "@storyshelf/core/orm";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import { baseAuthDateFields, baseAuthTables } from "./auth-tables.ts";
import { createShelfDbBridge } from "./db-bridge.ts";

const AUTH_DDL = `
CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, email_verified INTEGER NOT NULL DEFAULT 0, image TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE session (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, token TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, ip_address TEXT, user_agent TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE account (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, account_id TEXT NOT NULL, provider_id TEXT NOT NULL, access_token TEXT, refresh_token TEXT, id_token TEXT, access_token_expires_at TEXT, refresh_token_expires_at TEXT, scope TEXT, expires_at TEXT, password TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE verification (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
`;

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function testDb(): Promise<DatabaseAdapter> {
  // File-backed: product migrations run on setup, auth DDL is exec'd first
  // (db.all uses prepare().all(), which rejects DDL statements).
  const dir = mkdtempSync(join(tmpdir(), "storyshelf-auth-bridge-"));
  dirs.push(dir);
  const seed = new DatabaseSync(join(dir, "test.db"));
  seed.exec(AUTH_DDL);
  seed.close();
  const db = createSqliteDatabase(join(dir, "test.db"));
  await db.lifecycle?.setup({ config: {}, logger: undefined as never });
  return db;
}

function bridge(db: DatabaseAdapter) {
  return createShelfDbBridge(db, {
    tables: baseAuthTables as unknown as Record<string, Table>,
    dateFields: baseAuthDateFields,
  })({});
}

const createdAt = new Date("2026-01-01T00:00:00.000Z");

describe("createShelfDbBridge", () => {
  it("creates and finds with Date revival", async () => {
    const adapter = bridge(await testDb());
    await adapter.create({
      model: "user",
      data: { id: "u1", name: "Ada", email: "ada@example.com", createdAt, updatedAt: createdAt },
    });
    const found = await adapter.findOne<{ id: string; createdAt: Date }>({
      model: "user",
      where: [{ field: "email", value: "ada@example.com" }],
    });
    expect(found?.id).toBe("u1");
    expect(found?.createdAt).toBeInstanceOf(Date);
  });

  it("generates ids for creates missing one", async () => {
    const adapter = bridge(await testDb());
    const first = await adapter.create<{ id: unknown }>({
      model: "user",
      data: { name: "No Id", email: "noid@example.com", createdAt, updatedAt: createdAt },
    });
    const second = await adapter.create<{ id: unknown }>({
      model: "user",
      data: { name: "No Id 2", email: "noid2@example.com", createdAt, updatedAt: createdAt },
    });
    expect(typeof first.id).toBe("string");
    expect((first.id as string).length).toBeGreaterThan(0);
    expect(second.id).not.toBe(first.id);
  });

  it("supports operators, sort, limit, select, and count", async () => {
    const adapter = bridge(await testDb());
    const seeds = [
      ["u1", "a@example.com"],
      ["u2", "b@example.com"],
      ["u3", "c@example.com"],
    ] as const;
    const seed = async ([id, email]: readonly [string, string]): Promise<void> => {
      await adapter.create({
        model: "user",
        data: { id, name: id, email, createdAt, updatedAt: createdAt },
      });
    };
    await Promise.all(seeds.map(async (entry) => await seed(entry)));
    const many = await adapter.findMany<{ id: string }>({
      model: "user",
      where: [{ field: "email", operator: "contains", value: "@example.com" }],
      sortBy: { field: "email", direction: "desc" },
      limit: 2,
      select: ["id"],
    });
    expect(many.map((row) => row.id)).toEqual(["u3", "u2"]);
    expect(Object.keys(many[0] as object)).toEqual(["id"]);
    expect(
      await adapter.count({
        model: "user",
        where: [{ field: "id", operator: "in", value: ["u1", "u2"] }],
      }),
    ).toBe(2);
  });

  it("matches LIKE metacharacters literally and rejects non-array `in`", async () => {
    const adapter = bridge(await testDb());
    await adapter.create({
      model: "user",
      data: {
        id: "u1",
        name: "Under_score",
        email: "a@example.com",
        createdAt,
        updatedAt: createdAt,
      },
    });
    await adapter.create({
      model: "user",
      data: {
        id: "u2",
        name: "Percent%Sign",
        email: "b@example.com",
        createdAt,
        updatedAt: createdAt,
      },
    });
    const underscored = await adapter.findMany<{ id: string }>({
      model: "user",
      where: [{ field: "name", operator: "contains", value: "r_s" }],
    });
    expect(underscored.map((row) => row.id)).toEqual(["u1"]);
    const percent = await adapter.findMany<{ id: string }>({
      model: "user",
      where: [{ field: "name", operator: "contains", value: "t%S" }],
    });
    expect(percent.map((row) => row.id)).toEqual(["u2"]);
    await expect(
      adapter.findMany({ model: "user", where: [{ field: "id", operator: "in", value: "u1" }] }),
    ).rejects.toThrow(/array value/u);
  });

  it("updates, deletes, and consumes atomically", async () => {
    const adapter = bridge(await testDb());
    await adapter.create({
      model: "verification",
      data: {
        id: "v1",
        identifier: "tok",
        value: "s3cr3t",
        expiresAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      },
    });
    const updated = await adapter.update<{ value: string }>({
      model: "verification",
      where: [{ field: "id", value: "v1" }],
      update: { value: "r0tat3d" },
    });
    expect(updated?.value).toBe("r0tat3d");
    expect(
      await adapter.updateMany({
        model: "verification",
        where: [{ field: "id", value: "v1" }],
        update: { value: "again" },
      }),
    ).toBe(1);
    const consumed = await adapter.consumeOne<{ id: string }>({
      model: "verification",
      where: [{ field: "id", value: "v1" }],
    });
    expect(consumed?.id).toBe("v1");
    expect(
      await adapter.findOne({ model: "verification", where: [{ field: "id", value: "v1" }] }),
    ).toBeNull();
    expect(
      await adapter.consumeOne({ model: "verification", where: [{ field: "id", value: "v1" }] }),
    ).toBeNull();
  });

  it("fails fast on unknown models and fields", async () => {
    const adapter = bridge(await testDb());
    await expect(adapter.create({ model: "nope", data: {} })).rejects.toThrow(
      'Unknown auth model "nope"',
    );
    await expect(
      adapter.findOne({ model: "user", where: [{ field: "nope", value: "x" }] }),
    ).rejects.toThrow('Unknown auth field "nope"');
    await expect(
      adapter.findOne({
        model: "user",
        where: [{ field: "email", operator: "bogus" as never, value: "x" }],
      }),
    ).rejects.toThrow("Unsupported auth where operator");
  });

  it("routes transaction through transact when available", async () => {
    const db = await testDb();
    let usedTx = false;
    const txDb: DatabaseAdapter = {
      ...db,
      transact: async (fn) => {
        usedTx = true;
        return await fn(db);
      },
    };
    const txAdapter = createShelfDbBridge(txDb, {
      tables: baseAuthTables as unknown as Record<string, Table>,
      dateFields: baseAuthDateFields,
    })({});
    await txAdapter.transaction(async () => "ok");
    expect(usedTx).toBe(true);
  });

  it("runs consumeOne inside transaction without nesting transact", async () => {
    // Regression: Better Auth wraps verification-consume in its own
    // transaction; a second `begin` fails on single-connection sqlite.
    const db = await testDb();
    const adapter = bridge(db);
    await adapter.create({
      model: "verification",
      data: {
        id: "v9",
        identifier: "tok",
        value: "s3cr3t",
        expiresAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      },
    });
    let transactCalls = 0;
    const countingDb: DatabaseAdapter = {
      ...db,
      transact: async (fn) => {
        transactCalls += 1;
        if (transactCalls > 1) {
          throw new Error("nested transact");
        }
        return await db.transact!(fn);
      },
    };
    const counting = createShelfDbBridge(countingDb, {
      tables: baseAuthTables as unknown as Record<string, Table>,
      dateFields: baseAuthDateFields,
    })({});
    const consumed = await counting.transaction(async (tx) =>
      tx.consumeOne<{ id: string }>({
        model: "verification",
        where: [{ field: "id", value: "v9" }],
      }),
    );
    expect(consumed?.id).toBe("v9");
    expect(transactCalls).toBe(1);
    expect(
      await adapter.findOne({ model: "verification", where: [{ field: "id", value: "v9" }] }),
    ).toBeNull();
  });

  it("round-trips ssoProvider rows with JSON configs", async () => {
    const adapter = bridge(await testDb());
    await adapter.create({
      model: "user",
      data: { id: "u9", name: "SSO", email: "sso9@example.com", createdAt, updatedAt: createdAt },
    });
    const created = await adapter.create({
      model: "ssoProvider",
      data: {
        issuer: "http://localhost:3000",
        samlConfig: JSON.stringify({ issuer: "http://localhost:3000" }),
        userId: "u9",
        providerId: "acme-saml",
        domain: "example.com",
      },
    });
    expect(created["providerId"]).toBe("acme-saml");
    const found = await adapter.findOne<Record<string, unknown>>({
      model: "ssoProvider",
      where: [{ field: "providerId", value: "acme-saml" }],
    });
    expect(found?.["domain"]).toBe("example.com");
    expect(JSON.parse((found?.["samlConfig"] as string) ?? "{}")).toEqual({
      issuer: "http://localhost:3000",
    });
  });
});
