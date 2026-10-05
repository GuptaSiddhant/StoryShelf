import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { ulid } from "@storyshelf/core/utils";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { describe, expect, it } from "vitest";
import { baseAuthTables } from "./auth-tables.ts";
import { listUserSessions } from "./sessions.ts";

async function testDb(): Promise<DatabaseAdapter> {
  const db = createSqliteDatabase(":memory:");
  await db.lifecycle?.setup({ config: {}, logger: undefined as never });
  return db;
}

async function seedUser(db: DatabaseAdapter, userId: string): Promise<void> {
  const now = new Date().toISOString();
  await db.insert(baseAuthTables.user, {
    id: userId,
    name: "Session User",
    email: `${userId}@example.com`,
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedSession(
  db: DatabaseAdapter,
  userId: string,
  expiresAt: string,
  createdAt?: string,
): Promise<string> {
  const id = ulid();
  const now = createdAt ?? new Date().toISOString();
  await db.insert(baseAuthTables.session, {
    id,
    userId,
    token: `token-${id}`,
    expiresAt,
    ipAddress: "127.0.0.1",
    userAgent: "ShelfTest/1.0",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

describe("listUserSessions", () => {
  it("returns active sessions newest first and drops expired rows", async () => {
    const db = await testDb();
    const userId = ulid();
    await seedUser(db, userId);
    await seedUser(db, "other-user");
    // Distinct createdAt values: ulid() random bits make same-millisecond
    // ids unordered, so "newest first" is only well-defined across timestamps.
    const base = Date.now();
    await seedSession(db, userId, new Date(base - 1000).toISOString());
    const first = await seedSession(
      db,
      userId,
      new Date(base + 60_000).toISOString(),
      new Date(base).toISOString(),
    );
    const second = await seedSession(
      db,
      userId,
      new Date(base + 60_000).toISOString(),
      new Date(base + 1).toISOString(),
    );
    await seedSession(db, "other-user", new Date(base + 60_000).toISOString());

    const sessions = await listUserSessions(db, userId);
    expect(sessions.map((session) => session.id)).toEqual([second, first]);
    expect(sessions[0]?.token).toContain("token-");
    expect(sessions[0]?.userAgent).toBe("ShelfTest/1.0");
  });
});
