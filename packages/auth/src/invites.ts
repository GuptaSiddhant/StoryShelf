import type { DatabaseAdapter, TxStore } from "@storyshelf/core/adapter/database";
import { eq, getTableColumns, sql } from "@storyshelf/core/orm";
import type { SQL, Table } from "@storyshelf/core/orm";
/**
 * Invite-only local accounts on the engine: our tables own the invite,
 * Better Auth owns the credential.
 *
 * `issueInvite` stages a shelf `users` row plus a single-use token;
 * `acceptInvite` verifies the token, then writes the engine `user` row and
 * `credential` account row directly through the DatabaseAdapter. Direct
 * writes (instead of the admin `createUser` endpoint) because invite accept
 * is a pre-authentication flow and admin endpoints require a session by
 * design. Passwords use Better Auth's own hasher so engine sign-in verifies
 * them without format translation.
 */
import type { AuthUser } from "@storyshelf/core/types";
import { randomToken, sha256, timingSafeEqualString, ulid } from "@storyshelf/core/utils";
import { hashPassword } from "better-auth/crypto";
import { baseAuthTables } from "./auth-tables.ts";

const DEFAULT_INVITE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_INVITE_MS = 365 * 24 * 60 * 60 * 1000;

/** Minimum password length for local accounts (matches legacy policy). */
export const MIN_PASSWORD_LENGTH = 12;

/** Input for {@link issueInvite}. */
export interface IssueInviteInput {
  email: string;
  name: string;
  role: AuthUser["role"];
  /** Invite lifetime override. Defaults to 7 days. */
  inviteExpiryMs?: number;
}

/** Input for {@link acceptInvite} and {@link verifyInvite}. */
export interface InviteTokenInput {
  inviteId: string;
  token: string;
}

/** Input for {@link acceptInvite}. */
export interface AcceptInviteInput extends InviteTokenInput {
  password: string;
}

type ShelfRow = Record<string, unknown>;

/**
 * CRUD surface invites run on: the top-level adapter or a transaction store
 * (TxStore carries no table handles, so callers attach them). Both
 * DatabaseAdapter and TxStore satisfy this structurally.
 */
export type InviteStore = Pick<TxStore, "insert" | "update" | "get" | "remove" | "list"> & {
  readonly tables: DatabaseAdapter["tables"];
};

/**
 * Run `fn` inside a transaction. Invites are consume-once state: without
 * driver transactions concurrent accepts race, so transact is required
 * (every production driver offers it) rather than silently sequential.
 */
async function withInviteTx<R>(
  db: DatabaseAdapter,
  fn: (store: InviteStore) => Promise<R>,
): Promise<R> {
  if (!db.transact) {
    throw new Error("Shelf invites require a database with transaction support");
  }
  return await db.transact(async (tx) => await fn({ ...tx, tables: db.tables }));
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

function inviteError(): Error {
  return new Error("Invalid or expired invite");
}

/** Resolve a shelf/engine table column, failing fast on schema drift. */
export function tableColumn(table: Table, name: string): SQL {
  const column = getTableColumns(table)[name] as SQL | undefined;
  if (!column) {
    throw new Error(`Shelf table is missing column "${name}"`);
  }
  return column;
}

function assertPasswordPolicy(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error("Password must be at least 12 characters");
  }
}

async function listShelfUsersByEmail(db: InviteStore, email: string): Promise<ShelfRow[]> {
  return await db.list(db.tables.users, {
    where: eq(tableColumn(db.tables.users, "email"), normalizeEmail(email)),
    limit: 1,
  });
}

async function findEngineUserByEmail(db: InviteStore, email: string): Promise<ShelfRow | null> {
  // Case-insensitive: engine rows may carry provider-given casing while the
  // shelf normalizes (and UNIQUE(email) is case-sensitive, so an exact-only
  // lookup would 500 on a case-variant insert).
  const column = tableColumn(baseAuthTables.user, "email");
  const rows = (await db.list(baseAuthTables.user, {
    where: eq(sql`lower(${column})`, email.toLowerCase()),
    limit: 1,
  })) as ShelfRow[];
  return rows[0] ?? null;
}

async function findCredentialAccount(db: InviteStore, userId: string): Promise<ShelfRow | null> {
  const rows = (await db.list(baseAuthTables.account, {
    where: eq(tableColumn(baseAuthTables.account, "userId"), userId),
  })) as ShelfRow[];
  return rows.find((row) => row["providerId"] === "credential") ?? null;
}

/** Load the invite row, or throw the generic invite error. */
async function loadInvite(db: InviteStore, input: InviteTokenInput): Promise<ShelfRow> {
  const invite: ShelfRow | null = await db.get(db.tables.userInviteTokens, input.inviteId);
  if (!invite || invite["usedAt"]) {
    throw inviteError();
  }
  // Fail closed: a corrupt expiresAt parses to NaN, and NaN comparisons
  // are false — without this check the invite would never expire.
  const expires = new Date(String(invite["expiresAt"])).getTime();
  if (Number.isNaN(expires) || expires <= Date.now()) {
    throw inviteError();
  }
  if (!timingSafeEqualString(sha256(input.token), String(invite["tokenHash"]))) {
    throw inviteError();
  }
  return invite;
}

/** Load the invite plus its shelf user, or throw the generic invite error. */
async function assertInviteValid(
  db: InviteStore,
  input: InviteTokenInput,
): Promise<{ invite: ShelfRow; shelfUser: ShelfRow }> {
  const invite = await loadInvite(db, input);
  const shelfUser: ShelfRow | null = await db.get(db.tables.users, String(invite["userId"]));
  if (!shelfUser || shelfUser["disabled"]) {
    throw inviteError();
  }
  return { invite, shelfUser };
}

/** Create the credential account row, or refresh the existing password. */
async function upsertCredentialAccount(
  db: InviteStore,
  userId: string,
  password: string,
  now: string,
): Promise<void> {
  const hash = await hashPassword(password);
  const account = await findCredentialAccount(db, userId);
  if (account) {
    await db.update(baseAuthTables.account, String(account["id"]), {
      password: hash,
      updatedAt: now,
    });
    return;
  }
  await db.insert(baseAuthTables.account, {
    id: ulid(),
    userId,
    accountId: userId,
    providerId: "credential",
    password: hash,
    createdAt: now,
    updatedAt: now,
  });
}

/** Create the engine identity rows (shared id), or refresh the credential. */
export async function ensureEngineIdentity(
  db: InviteStore,
  shelfUser: ShelfRow,
  password: string,
): Promise<void> {
  const userId = String(shelfUser["id"]);
  const email = String(shelfUser["email"]);
  const now = new Date().toISOString();
  // Verified-email linking only: an existing engine row takes the credential
  // when its email is verified (same owner). An unverified row (e.g. an OIDC
  // identity with an untrusted email claim) must stay separate — but engine
  // emails are UNIQUE, so no second row can mint: reject and point at SSO.
  const engineUser = await findEngineUserByEmail(db, email);
  if (engineUser && engineUser["emailVerified"] !== true) {
    throw new Error(
      "Email is registered with an unverified SSO identity; sign in with SSO instead",
    );
  }
  if (!engineUser) {
    await db.insert(baseAuthTables.user, {
      id: userId,
      name: String(shelfUser["name"]),
      email,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    });
  }
  const targetId = engineUser ? String(engineUser["id"]) : userId;
  await upsertCredentialAccount(db, targetId, password, now);
}

function toAuthUser(row: ShelfRow): AuthUser {
  return {
    id: String(row["id"]),
    email: String(row["email"]),
    name: String(row["name"]),
    avatarUrl: (row["avatarUrl"] as string | null) ?? undefined,
    role: row["role"] as AuthUser["role"],
  };
}

function inviteLifetimeMs(expiryMs: number | undefined): number {
  const lifetime = expiryMs ?? DEFAULT_INVITE_MS;
  if (!Number.isFinite(lifetime) || lifetime <= 0 || lifetime > MAX_INVITE_MS) {
    throw new Error("Invite lifetime must be between 1ms and 365 days");
  }
  return lifetime;
}

/** Refresh name/role on the existing row (re-invite is admin intent). */
async function refreshShelfUser(
  db: InviteStore,
  id: string,
  input: IssueInviteInput,
): Promise<ShelfRow> {
  const updated: ShelfRow = await db.update(db.tables.users, id, {
    name: input.name.trim(),
    role: input.role,
  });
  return updated;
}

async function stageShelfUser(db: InviteStore, input: IssueInviteInput): Promise<ShelfRow> {
  const email = normalizeEmail(input.email);
  if (!isEmail(email)) {
    throw new Error("Invalid email");
  }
  if (input.name.trim() === "") {
    throw new Error("Name is required");
  }
  const existing = await listShelfUsersByEmail(db, email);
  // Re-invite refreshes name and role: issuing is operator-only, so the
  // latest invite is the current admin intent (and the password flow).
  if (existing[0]) {
    return await refreshShelfUser(db, String(existing[0]["id"]), input);
  }
  const now = new Date().toISOString();
  return await db.insert(db.tables.users, {
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
  });
}

async function removeUnusedInvite(db: InviteStore, row: ShelfRow): Promise<void> {
  await db.remove(db.tables.userInviteTokens, String(row["id"]));
}

async function supersedeUnusedInvites(db: InviteStore, userId: string): Promise<void> {
  const existing = (await db.list(db.tables.userInviteTokens, {
    where: eq(tableColumn(db.tables.userInviteTokens, "userId"), userId),
  })) as ShelfRow[];
  await Promise.all(
    existing
      .filter((row) => !row["usedAt"])
      .map(async (row) => {
        await removeUnusedInvite(db, row);
      }),
  );
}

/** Stage a shelf user and mint a single-use invite token (returned once). */
export async function issueInvite(
  db: DatabaseAdapter,
  input: IssueInviteInput,
): Promise<{ inviteId: string; token: string; expiresAt: string }> {
  return await withInviteTx(db, async (store) => {
    const shelfUser = await stageShelfUser(store, input);
    const userId = String(shelfUser["id"]);
    await supersedeUnusedInvites(store, userId);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + inviteLifetimeMs(input.inviteExpiryMs)).toISOString();
    const inviteId = ulid();
    const token = randomToken("inv_").value;
    await store.insert(store.tables.userInviteTokens, {
      id: inviteId,
      userId,
      tokenHash: sha256(token),
      expiresAt,
      usedAt: null,
      createdAt: now,
    });
    return { inviteId, token, expiresAt };
  });
}

/** Check an invite token without consuming it (drives the accept page). */
export async function verifyInvite(
  db: DatabaseAdapter,
  input: InviteTokenInput,
): Promise<{ email: string; name: string }> {
  const { shelfUser } = await assertInviteValid(db, input);
  return { email: String(shelfUser["email"]), name: String(shelfUser["name"]) };
}

/** Whether an invite row is already spent (busy-downgrade probe). */
async function inviteSpent(db: InviteStore, inviteId: string): Promise<boolean> {
  const invite: ShelfRow | null = await db.get(db.tables.userInviteTokens, inviteId);
  return !!invite?.["usedAt"];
}

/** Consume an invite: set the engine credential and return the shelf user. */
export async function acceptInvite(
  db: DatabaseAdapter,
  input: AcceptInviteInput,
): Promise<AuthUser> {
  assertPasswordPolicy(input.password);
  try {
    return await withInviteTx(db, async (store) => {
      const { invite, shelfUser } = await assertInviteValid(store, input);
      await ensureEngineIdentity(store, shelfUser, input.password);
      const now = new Date().toISOString();
      await store.update(store.tables.users, String(shelfUser["id"]), { lastLoginAt: now });
      await store.update(store.tables.userInviteTokens, String(invite["id"]), { usedAt: now });
      return toAuthUser(shelfUser);
    });
  } catch (error) {
    // A transaction loser (e.g. sqlite's busy connection) surfaces a driver
    // error instead of the invite error; re-probe so callers see the stable
    // "Invalid or expired invite" whenever the winner consumed the token.
    if (await inviteSpent(db, input.inviteId)) {
      throw inviteError();
    }
    throw error;
  }
}
