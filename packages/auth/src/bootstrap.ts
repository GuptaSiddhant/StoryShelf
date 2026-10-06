/**
 * Development bootstrap: provision a local admin from environment credentials.
 *
 * Replaces the dropped shared-password tier for `dev-server`/`fly-app`:
 * with `AUTH_PASSWORD` set, the first boot creates an admin identity and
 * every boot aligns its engine credential with the env value (same
 * always-from-env semantics the shared tier had). Production deployments
 * use the invite flow instead.
 */
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { eq } from "@storyshelf/core/orm";
import { ulid } from "@storyshelf/core/utils";
import { ensureEngineIdentity, MIN_PASSWORD_LENGTH, tableColumn } from "./invites.ts";

/** Matches what Better Auth accepts at sign-in: the domain needs a dot. */
const ENGINE_EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u;

/** Input for {@link ensurePasswordAdmin}. */
export interface PasswordAdminInput {
  email: string;
  name?: string;
  password: string;
}

/** Find the env admin row, or stage it (admin role, no credential yet). */
async function stagePasswordAdmin(
  db: DatabaseAdapter,
  email: string,
  name: string,
  now: string,
): Promise<Record<string, unknown>> {
  const rows: Record<string, unknown>[] = await db.list(db.tables.users, {
    where: eq(tableColumn(db.tables.users, "email"), email),
    limit: 1,
  });
  const existing = rows[0];
  if (existing) {
    return existing;
  }
  return await db.insert(db.tables.users, {
    id: ulid(),
    email,
    name,
    avatarUrl: null,
    role: "admin",
    lastLoginAt: null,
    createdAt: now,
    passwordHash: null,
    displayNameOverride: null,
    authProvider: "local",
    disabled: false,
  });
}

/** Provision (or refresh the credential of) the env-driven local admin. */
export async function ensurePasswordAdmin(
  db: DatabaseAdapter,
  input: PasswordAdminInput,
): Promise<void> {
  const email = input.email.trim().toLowerCase();
  if (!ENGINE_EMAIL.test(email)) {
    // The engine rejects dotless domains (e.g. admin@local) at sign-in, so the account could never log in.
    throw new Error(`AUTH_EMAIL "${email}" is not a valid email address (domain needs a dot)`);
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error("Password must be at least 12 characters");
  }
  const now = new Date().toISOString();
  const shelfUser = await stagePasswordAdmin(db, email, input.name ?? "Admin", now);
  await ensureEngineIdentity(db, shelfUser, input.password);
}
