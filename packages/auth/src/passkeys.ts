/**
 * Shelf-side passkey inventory plus the local-credential flag.
 *
 * The profile page needs both to decide which security sections to render:
 * the key list (with the "register a 2nd key" nudge) and the password form
 * (only when a `credential` account exists — social-only users have none).
 * Registration and deletion go through the passkey plugin endpoints;
 * deletion is ownership-scoped server-side.
 */
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { eq } from "drizzle-orm";
import { baseAuthTables } from "./auth-tables.ts";
import { tableColumn } from "./invites.ts";

/** One registered passkey for the profile page. */
export interface EnginePasskeyInfo {
  id: string;
  name: string | null;
  deviceType: string;
  backedUp: boolean;
  transports: string | null;
  aaguid: string | null;
  createdAt: string;
}

/** Registered passkeys for a user, oldest first. */
export async function listUserPasskeys(
  db: DatabaseAdapter,
  userId: string,
): Promise<EnginePasskeyInfo[]> {
  const rows = (await db.list(baseAuthTables.passkey, {
    where: eq(tableColumn(baseAuthTables.passkey, "userId"), userId),
  })) as Record<string, unknown>[];
  return rows
    .map((row) => ({
      id: String(row["id"]),
      name: (row["name"] as string | null) ?? null,
      deviceType: typeof row["deviceType"] === "string" ? row["deviceType"] : "unknown",
      backedUp: row["backedUp"] === true,
      transports: (row["transports"] as string | null) ?? null,
      aaguid: (row["aaguid"] as string | null) ?? null,
      createdAt: String(row["createdAt"]),
    }))
    .toSorted((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

/** Whether the user can change a local password (has a credential account). */
export async function hasPasswordCredential(db: DatabaseAdapter, userId: string): Promise<boolean> {
  const rows = (await db.list(baseAuthTables.account, {
    where: eq(tableColumn(baseAuthTables.account, "userId"), userId),
  })) as Record<string, unknown>[];
  return rows.some((row) => row["providerId"] === "credential");
}
