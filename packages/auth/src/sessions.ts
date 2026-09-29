/**
 * Shelf-side session inventory for the profile device list.
 *
 * Listing reads our `session` table directly (full rows, including tokens
 * for revoke + current-device matching). Mutations go through engine
 * endpoints (`/revoke-session` is ownership-checked server-side,
 * `/revoke-other-sessions` keeps the caller), never raw deletes.
 */
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { eq } from "drizzle-orm";
import { baseAuthTables } from "./auth-tables.ts";
import { tableColumn } from "./invites.ts";

/** One device session for the profile page. */
export interface EngineSessionInfo {
  id: string;
  token: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
}

/**
 * Raw session token from a possibly-signed cookie value (`token.signature`).
 * Single shared parser: cookies, CSRF binding, and table lookups must agree.
 */
export function unsignedToken(value: string): string {
  return value.split(".")[0] ?? "";
}

/** Delete every session row for a user (eager revocation on disable). */
export async function deleteUserSessions(db: DatabaseAdapter, userId: string): Promise<number> {
  const rows = (await db.list(baseAuthTables.session, {
    where: eq(tableColumn(baseAuthTables.session, "userId"), userId),
  })) as Record<string, unknown>[];
  await Promise.all(
    rows.map(async (row) => {
      await db.remove(baseAuthTables.session, String(row["id"]));
    }),
  );
  return rows.length;
}

/** Delete one session by token (accepts the signed cookie value or raw token). */
export async function deleteSessionByToken(db: DatabaseAdapter, token: string): Promise<boolean> {
  const raw = token.split(".")[0] ?? "";
  if (!raw) {
    return false;
  }
  const rows = (await db.list(baseAuthTables.session, {
    where: eq(tableColumn(baseAuthTables.session, "token"), raw),
    limit: 1,
  })) as Record<string, unknown>[];
  const row = rows[0];
  if (!row) {
    return false;
  }
  await db.remove(baseAuthTables.session, String(row["id"]));
  return true;
}

/** Active sessions for a user, newest first (expired rows are dropped). */
export async function listUserSessions(
  db: DatabaseAdapter,
  userId: string,
): Promise<EngineSessionInfo[]> {
  const rows = (await db.list(baseAuthTables.session, {
    where: eq(tableColumn(baseAuthTables.session, "userId"), userId),
  })) as Record<string, unknown>[];
  const now = Date.now();
  return rows
    .filter((row) => new Date(String(row["expiresAt"])).getTime() > now)
    .map((row) => ({
      id: String(row["id"]),
      token: String(row["token"]),
      ipAddress: (row["ipAddress"] as string | null) ?? null,
      userAgent: (row["userAgent"] as string | null) ?? null,
      createdAt: String(row["createdAt"]),
      expiresAt: String(row["expiresAt"]),
    }))
    .toSorted((a, b) =>
      a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt < b.createdAt ? 1 : -1,
    );
}
