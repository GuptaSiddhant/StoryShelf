import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { verifyPassword } from "better-auth/crypto";
import { eq, getTableColumns } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import { baseAuthTables } from "./auth-tables.ts";
import { ensurePasswordAdmin } from "./bootstrap.ts";

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
  const dir = mkdtempSync(join(tmpdir(), "storyshelf-bootstrap-"));
  dirs.push(dir);
  const seed = new DatabaseSync(join(dir, "test.db"));
  seed.exec(AUTH_DDL);
  seed.close();
  const db = createSqliteDatabase(join(dir, "test.db"));
  await db.lifecycle?.setup({ config: {}, logger: undefined as never });
  return db;
}

async function shelfAdmin(db: DatabaseAdapter): Promise<Record<string, unknown> | null> {
  const rows = (await db.list(db.tables.users, {
    where: eq(getTableColumns(db.tables.users)["email"] as unknown as SQLWrapper, "admin@local"),
    limit: 1,
  })) as unknown as Record<string, unknown>[];
  return rows[0] ?? null;
}

describe("ensurePasswordAdmin", () => {
  it("provisions the admin identity with a verifiable engine credential", async () => {
    const db = await testDb();
    await ensurePasswordAdmin(db, { email: "admin@local", password: "dev-password-12" });
    const admin = await shelfAdmin(db);
    expect(admin?.["role"]).toBe("admin");

    const accounts = (await db.list(baseAuthTables.account, {
      where: eq(
        getTableColumns(baseAuthTables.account)["userId"] as unknown as SQLWrapper,
        String(admin?.["id"]),
      ),
    })) as unknown as Record<string, unknown>[];
    const credential = accounts.find((row) => row["providerId"] === "credential");
    await expect(
      verifyPassword({ hash: String(credential?.["password"]), password: "dev-password-12" }),
    ).resolves.toBe(true);
  });

  it("refreshes the credential on repeat boots and rejects short passwords", async () => {
    const db = await testDb();
    await ensurePasswordAdmin(db, { email: "admin@local", password: "dev-password-12" });
    await ensurePasswordAdmin(db, { email: "admin@local", password: "rotated-pass-34" });
    const admin = await shelfAdmin(db);
    const accounts = (await db.list(baseAuthTables.account, {
      where: eq(
        getTableColumns(baseAuthTables.account)["userId"] as unknown as SQLWrapper,
        String(admin?.["id"]),
      ),
    })) as unknown as Record<string, unknown>[];
    const credential = accounts.find((row) => row["providerId"] === "credential");
    await expect(
      verifyPassword({ hash: String(credential?.["password"]), password: "rotated-pass-34" }),
    ).resolves.toBe(true);
    await expect(
      ensurePasswordAdmin(db, { email: "admin@local", password: "short" }),
    ).rejects.toThrow(/at least 12/u);
  });
});
