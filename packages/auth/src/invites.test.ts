import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { UserModel } from "@storyshelf/core/models";
import { eq, getTableColumns } from "@storyshelf/core/orm";
import type { SQLWrapper } from "@storyshelf/core/orm";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { verifyPassword } from "better-auth/crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import { baseAuthTables } from "./auth-tables.ts";
import { acceptInvite, issueInvite, verifyInvite } from "./invites.ts";

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
  const dir = mkdtempSync(join(tmpdir(), "storyshelf-invites-"));
  dirs.push(dir);
  const seed = new DatabaseSync(join(dir, "test.db"));
  seed.exec(AUTH_DDL);
  seed.close();
  const db = createSqliteDatabase(join(dir, "test.db"));
  await db.lifecycle?.setup({ config: {}, logger: undefined as never });
  return db;
}

async function credentialHash(db: DatabaseAdapter, userId: string): Promise<string | null> {
  const rows = (await db.list(baseAuthTables.account, {
    where: eq(getTableColumns(baseAuthTables.account)["userId"] as unknown as SQLWrapper, userId),
  })) as unknown as Record<string, unknown>[];
  const credential = rows.find((row) => row["providerId"] === "credential");
  return (credential?.["password"] as string | null) ?? null;
}

describe("engine invites", () => {
  it("issues, verifies, and accepts an admin invite with an engine credential", async () => {
    const db = await testDb();
    const issued = await issueInvite(db, {
      email: "lead@example.com",
      name: "Lead",
      role: "admin",
    });
    expect(issued.token.startsWith("inv_")).toBe(true);

    await expect(
      verifyInvite(db, { inviteId: issued.inviteId, token: issued.token }),
    ).resolves.toEqual({ email: "lead@example.com", name: "Lead" });

    const user = await acceptInvite(db, {
      inviteId: issued.inviteId,
      token: issued.token,
      password: "correct-horse-12",
    });
    expect(user.email).toBe("lead@example.com");
    expect(user.role).toBe("admin");

    const stored = await new UserModel(db).get(user.id);
    expect(stored?.role).toBe("admin");

    const engineUsers = (await db.list(baseAuthTables.user, {
      where: eq(
        getTableColumns(baseAuthTables.user)["email"] as unknown as SQLWrapper,
        "lead@example.com",
      ),
    })) as unknown as Record<string, unknown>[];
    expect(engineUsers).toHaveLength(1);
    expect(String(engineUsers[0]?.["id"])).toBe(user.id);

    const hash = await credentialHash(db, user.id);
    expect(hash).toBeTruthy();
    await expect(verifyPassword({ hash: hash ?? "", password: "correct-horse-12" })).resolves.toBe(
      true,
    );

    await expect(
      verifyInvite(db, { inviteId: issued.inviteId, token: issued.token }),
    ).rejects.toThrow(/Invalid or expired/u);
  });

  it("rejects short passwords, wrong tokens, and expired invites", async () => {
    const db = await testDb();
    const issued = await issueInvite(db, { email: "fin@example.com", name: "Fin", role: "member" });
    await expect(
      acceptInvite(db, { inviteId: issued.inviteId, token: issued.token, password: "short" }),
    ).rejects.toThrow(/at least 12/u);
    await expect(
      acceptInvite(db, {
        inviteId: issued.inviteId,
        token: "inv_wrong",
        password: "long-enough-12",
      }),
    ).rejects.toThrow(/Invalid or expired/u);

    const stale = { inviteExpiryMs: -1000 };
    await expect(
      issueInvite(db, { email: "old@example.com", name: "Old", role: "member", ...stale }),
    ).rejects.toThrow(/between 1ms and 365 days/u);
    await expect(
      issueInvite(db, {
        email: "old@example.com",
        name: "Old",
        role: "member",
        inviteExpiryMs: Number.NaN,
      }),
    ).rejects.toThrow(/between 1ms and 365 days/u);
  });

  it("rejects invites with corrupt expiry", async () => {
    const db = await testDb();
    const issued = await issueInvite(db, { email: "rot@example.com", name: "Rot", role: "member" });
    await db.update(db.tables.userInviteTokens, issued.inviteId, { expiresAt: "not-a-date" });
    await expect(
      verifyInvite(db, { inviteId: issued.inviteId, token: issued.token }),
    ).rejects.toThrow(/Invalid or expired/u);
  });

  it("rejects a second accept of the same invite", async () => {
    const db = await testDb();
    const issued = await issueInvite(db, {
      email: "twice@example.com",
      name: "Twice",
      role: "member",
    });
    await acceptInvite(db, {
      inviteId: issued.inviteId,
      token: issued.token,
      password: "correct-horse-12",
    });
    await expect(
      acceptInvite(db, {
        inviteId: issued.inviteId,
        token: issued.token,
        password: "correct-horse-12",
      }),
    ).rejects.toThrow(/Invalid or expired/u);
  });

  it("links credentials only to verified engine identities", async () => {
    const db = await testDb();
    const now = new Date().toISOString();
    const seedEngineUser = async (id: string, email: string, verified: boolean): Promise<void> => {
      await db.insert(baseAuthTables.user, {
        id,
        name: "Prior",
        email,
        emailVerified: verified,
        image: null,
        createdAt: now,
        updatedAt: now,
      });
    };
    await seedEngineUser("oauth-unverified", "split@example.com", false);
    await seedEngineUser("oauth-verified", "linked@example.com", true);

    // Unverified row stays separate: no duplicate engine row can mint under
    // UNIQUE(email), so accept fails cleanly and points at SSO.
    const split = await issueInvite(db, {
      email: "split@example.com",
      name: "Split",
      role: "member",
    });
    await expect(
      acceptInvite(db, {
        inviteId: split.inviteId,
        token: split.token,
        password: "correct-horse-12",
      }),
    ).rejects.toThrow(/unverified SSO identity/u);
    expect(await credentialHash(db, "oauth-unverified")).toBeNull();

    // Verified row takes the credential (same owner).
    const linked = await issueInvite(db, {
      email: "linked@example.com",
      name: "Linked",
      role: "member",
    });
    const linkedUser = await acceptInvite(db, {
      inviteId: linked.inviteId,
      token: linked.token,
      password: "correct-horse-12",
    });
    expect(await credentialHash(db, "oauth-verified")).not.toBeNull();
    expect(linkedUser.email).toBe("linked@example.com");

    // Case-variant verified row links instead of 500ing on UNIQUE(email).
    await seedEngineUser("oauth-case", "Case@Example.com", true);
    const cased = await issueInvite(db, {
      email: "case@example.com",
      name: "Case",
      role: "member",
    });
    await acceptInvite(db, {
      inviteId: cased.inviteId,
      token: cased.token,
      password: "correct-horse-12",
    });
    expect(await credentialHash(db, "oauth-case")).not.toBeNull();
  });

  it("lets exactly one concurrent accept win", async () => {
    const db = await testDb();
    const issued = await issueInvite(db, {
      email: "race@example.com",
      name: "Race",
      role: "member",
    });
    const attempt = (): Promise<unknown> =>
      acceptInvite(db, {
        inviteId: issued.inviteId,
        token: issued.token,
        password: "correct-horse-12",
      });
    const [first, second] = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = [first, second].filter((result) => result.status === "fulfilled");
    const rejected = [first, second].filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it("rejects invites for disabled users and supersedes reissued tokens", async () => {
    const db = await testDb();
    const first = await issueInvite(db, { email: "zed@example.com", name: "Zed", role: "member" });
    const second = await issueInvite(db, {
      email: "zed@example.com",
      name: "Zed Cooper",
      role: "admin",
    });
    await expect(
      verifyInvite(db, { inviteId: first.inviteId, token: first.token }),
    ).rejects.toThrow(/Invalid or expired/u);
    // Re-invite refreshes name and role to the latest admin intent.
    const reissued = (await db.list(db.tables.users, {
      where: eq(
        getTableColumns(db.tables.users)["email"] as unknown as SQLWrapper,
        "zed@example.com",
      ),
    })) as unknown as Record<string, unknown>[];
    expect(reissued[0]?.["name"]).toBe("Zed Cooper");
    expect(reissued[0]?.["role"]).toBe("admin");

    const shelfUsers = (await db.list(db.tables.users, {
      where: eq(
        getTableColumns(db.tables.users)["email"] as unknown as SQLWrapper,
        "zed@example.com",
      ),
    })) as unknown as Record<string, unknown>[];
    await db.update(db.tables.users, String(shelfUsers[0]?.["id"]), { disabled: true });
    await expect(
      acceptInvite(db, {
        inviteId: second.inviteId,
        token: second.token,
        password: "long-enough-12",
      }),
    ).rejects.toThrow(/Invalid or expired/u);
  });
});
