import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { ulid } from "@storyshelf/core/utils";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { describe, expect, it } from "vitest";
import { baseAuthTables } from "./auth-tables.ts";
import { hasPasswordCredential, listUserPasskeys } from "./passkeys.ts";

async function testDb(): Promise<DatabaseAdapter> {
  const db = createSqliteDatabase(":memory:");
  await db.lifecycle?.setup({ config: {}, logger: undefined as never });
  return db;
}

async function seedUser(db: DatabaseAdapter, userId: string): Promise<void> {
  const now = new Date().toISOString();
  await db.insert(baseAuthTables.user, {
    id: userId,
    name: "Key User",
    email: `${userId}@example.com`,
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedPasskey(db: DatabaseAdapter, userId: string, name: string): Promise<string> {
  const id = ulid();
  const now = new Date().toISOString();
  await db.insert(baseAuthTables.passkey, {
    id,
    name,
    publicKey: "cGsta2V5",
    userId,
    credentialID: `cred-${id}`,
    counter: 0,
    deviceType: "platform",
    backedUp: true,
    transports: "internal",
    aaguid: null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function seedCredential(db: DatabaseAdapter, userId: string): Promise<void> {
  const now = new Date().toISOString();
  await db.insert(baseAuthTables.account, {
    id: ulid(),
    userId,
    accountId: userId,
    providerId: "credential",
    password: "irrelevant",
    createdAt: now,
    updatedAt: now,
  });
}

describe("passkey inventory", () => {
  it("lists keys oldest first with device details", async () => {
    const db = await testDb();
    const userId = ulid();
    await seedUser(db, userId);
    await seedUser(db, "other-user");
    const first = await seedPasskey(db, userId, "Laptop");
    const second = await seedPasskey(db, userId, "Phone");
    await seedPasskey(db, "other-user", "Other");

    const keys = await listUserPasskeys(db, userId);
    expect(keys.map((key) => key.id)).toEqual([first, second]);
    expect(keys[0]).toMatchObject({ name: "Laptop", deviceType: "platform", backedUp: true });
  });

  it("detects the local credential flag", async () => {
    const db = await testDb();
    const userId = ulid();
    await seedUser(db, userId);
    await expect(hasPasswordCredential(db, userId)).resolves.toBe(false);
    await seedCredential(db, userId);
    await expect(hasPasswordCredential(db, userId)).resolves.toBe(true);
  });
});
