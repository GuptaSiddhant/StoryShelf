/* oxlint-disable eslint/max-statements, eslint/max-lines-per-function, eslint/require-await, typescript/no-unnecessary-type-assertion, typescript/no-base-to-string, typescript/prefer-nullish-coalescing, typescript/promise-function-async, typescript/prefer-optional-chain -- invite flow is multi-step DB + crypto; splitting further would obscure the transaction */
import type { AuthUser } from "@storyshelf/core/adapter/auth";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { randomToken, sha256, ulid } from "@storyshelf/core/utils";
import { eq, getTableColumns } from "drizzle-orm";
import { hashPassword, isValidPassword, verifyPassword } from "./password-hash.ts";
import { createSessionHandlers } from "./session.ts";
import type { AccountAuth, AccountAuthOptions } from "./types.ts";

declare const __PKG_VERSION__: string | undefined;

const DEFAULT_INVITE_MS = 7 * 24 * 60 * 60 * 1000;

function packageVersion(): string {
  return (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0";
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

async function findUserByEmail(
  db: DatabaseAdapter,
  email: string,
): Promise<Record<string, unknown> | null> {
  const lower = normalizeEmail(email);
  const rows = (await db.list(db.tables.users, {
    where: eq(getTableColumns(db.tables.users)["email"] as never, lower),
    limit: 1,
  })) as unknown as Record<string, unknown>[];
  return rows[0] ?? null;
}

async function findInvite(
  db: DatabaseAdapter,
  inviteId: string,
): Promise<Record<string, unknown> | null> {
  return (await db.get(db.tables.userInviteTokens, inviteId)) as unknown as Record<
    string,
    unknown
  > | null;
}

function toAuthUser(row: Record<string, unknown>): AuthUser {
  return {
    id: String(row["id"]),
    email: String(row["email"]),
    name: String(row["name"]),
    avatarUrl: (row["avatarUrl"] as string | null) ?? undefined,
    role: row["role"] as AuthUser["role"],
    providerId: "account",
  };
}

function buildCheck(db: DatabaseAdapter, sessions: ReturnType<typeof createSessionHandlers>) {
  return async (request: Request): Promise<AuthUser | null> => {
    const user = await sessions.check(request);
    if (!user) {
      return null;
    }
    if (user.providerId && user.providerId !== "account") {
      return user;
    }
    const row = (await db.get(db.tables.users, user.id)) as unknown as Record<
      string,
      unknown
    > | null;
    if (!row || row["disabled"]) {
      return null;
    }
    const override = row["displayNameOverride"] as string | null;
    return override ? { ...user, name: override } : user;
  };
}

function buildLogin(db: DatabaseAdapter, sessions: ReturnType<typeof createSessionHandlers>) {
  return async (email: string, password: string): Promise<string> => {
    const lower = normalizeEmail(email);
    if (!isEmail(lower)) {
      throw new Error("Invalid credentials");
    }
    const row = await findUserByEmail(db, lower);
    if (!row || row["disabled"] || !row["passwordHash"]) {
      throw new Error("Invalid credentials");
    }
    const ok = await verifyPassword(password, String(row["passwordHash"]));
    if (!ok) {
      throw new Error("Invalid credentials");
    }
    const now = new Date().toISOString();
    await db.update(db.tables.users, String(row["id"]), { lastLoginAt: now } as never);
    return sessions.createSession(toAuthUser(row));
  };
}

function buildIssueInvite(db: DatabaseAdapter, inviteExpiryMs: number) {
  return async (input: {
    email: string;
    name: string;
    role: AuthUser["role"];
  }): Promise<{
    inviteId: string;
    token: string;
    expiresAt: string;
  }> => {
    const email = normalizeEmail(input.email);
    if (!isEmail(email)) {
      throw new Error("Invalid email");
    }
    if (!input.name.trim()) {
      throw new Error("Name is required");
    }
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + inviteExpiryMs).toISOString();
    let userRow = await findUserByEmail(db, email);
    if (!userRow) {
      userRow = (await db.insert(db.tables.users, {
        id: ulid(),
        email,
        name: input.name.trim(),
        avatarUrl: null,
        role: input.role,
        lastLoginAt: null,
        createdAt: now,
        passwordHash: null,
        displayNameOverride: null,
        authProvider: "local",
        disabled: false,
      } as never)) as unknown as Record<string, unknown>;
    }
    const userId = String(userRow["id"]);
    const existing = (await db.list(db.tables.userInviteTokens, {
      where: eq(getTableColumns(db.tables.userInviteTokens)["userId"] as never, userId),
    })) as unknown as Record<string, unknown>[];
    await Promise.all(
      existing
        .filter((row) => !row["usedAt"])
        .map((row) => db.remove(db.tables.userInviteTokens, String(row["id"]))),
    );
    const inviteId = ulid();
    const token = randomToken("inv_").value;
    await db.insert(db.tables.userInviteTokens, {
      id: inviteId,
      userId,
      tokenHash: sha256(token),
      expiresAt,
      usedAt: null,
      createdAt: now,
    } as never);
    return { inviteId, token, expiresAt };
  };
}

function buildAcceptInvite(db: DatabaseAdapter) {
  return async (input: {
    inviteId: string;
    token: string;
    password: string;
  }): Promise<AuthUser> => {
    if (!isValidPassword(input.password)) {
      throw new Error("Password must be at least 12 characters");
    }
    const invite = await findInvite(db, input.inviteId);
    if (!invite || invite["usedAt"]) {
      throw new Error("Invalid or expired invite");
    }
    if (new Date(String(invite["expiresAt"])).getTime() <= Date.now()) {
      throw new Error("Invalid or expired invite");
    }
    if (sha256(input.token) !== String(invite["tokenHash"])) {
      throw new Error("Invalid or expired invite");
    }
    const row = (await db.get(db.tables.users, String(invite["userId"]))) as unknown as Record<
      string,
      unknown
    > | null;
    if (!row || row["disabled"]) {
      throw new Error("Invalid or expired invite");
    }
    const hash = await hashPassword(input.password);
    const now = new Date().toISOString();
    await db.update(db.tables.users, String(row["id"]), {
      passwordHash: hash,
      lastLoginAt: now,
    } as never);
    await db.update(db.tables.userInviteTokens, String(invite["id"]), { usedAt: now } as never);
    const updated = (await db.get(db.tables.users, String(row["id"]))) as unknown as Record<
      string,
      unknown
    >;
    return toAuthUser(updated ?? row);
  };
}

function buildChangePassword(db: DatabaseAdapter) {
  return async (input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<void> => {
    if (!isValidPassword(input.newPassword)) {
      throw new Error("Password must be at least 12 characters");
    }
    const row = (await db.get(db.tables.users, input.userId)) as unknown as Record<
      string,
      unknown
    > | null;
    if (!row || !row["passwordHash"]) {
      throw new Error("Invalid credentials");
    }
    const ok = await verifyPassword(input.currentPassword, String(row["passwordHash"]));
    if (!ok) {
      throw new Error("Invalid credentials");
    }
    const hash = await hashPassword(input.newPassword);
    await db.update(db.tables.users, input.userId, { passwordHash: hash } as never);
  };
}

function buildSetDisabled(db: DatabaseAdapter) {
  return async (userId: string, disabled: boolean): Promise<void> => {
    await db.update(db.tables.users, userId, { disabled } as never);
  };
}

/** Create an invite-only local account auth adapter. */
export function createAccountAuth(options: AccountAuthOptions): AccountAuth {
  const { db, secret } = options;
  const inviteExpiryMs = options.inviteExpiryMs ?? DEFAULT_INVITE_MS;
  const sessions = createSessionHandlers(secret);
  return {
    metadata: {
      name: "Account Auth",
      version: packageVersion(),
      description: "Invite-only local account auth adapter",
      kind: "account",
      category: "auth",
    },
    lifecycle: {
      setup: async () => {
        if (secret === "") {
          throw new Error("Account auth requires a non-empty secret");
        }
      },
      teardown: async () => {},
      health: async () => ({ ok: true }),
    },
    check: buildCheck(db, sessions),
    createSession: (user) => sessions.createSession(user),
    async destroySession() {},
    loginWithCredentials: buildLogin(db, sessions),
    issueInvite: buildIssueInvite(db, inviteExpiryMs),
    acceptInvite: buildAcceptInvite(db),
    changePassword: buildChangePassword(db),
    setDisabled: buildSetDisabled(db),
  };
}
