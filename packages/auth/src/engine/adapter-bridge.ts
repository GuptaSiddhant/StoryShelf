/** The `Auth` singleton over the Better Auth instance: user mirror, session resolve and revoke, disable. */
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { Auth, EngineLoginMethod } from "@storyshelf/core/auth";
import { UserModel } from "@storyshelf/core/models";
import { SESSION_COOKIE, type AuthUser } from "@storyshelf/core/types";
import { hasPasswordCredential, listUserPasskeys } from "../passkeys.ts";
import {
  deleteSessionByToken,
  deleteUserSessions,
  listUserSessions,
  purgeExpiredAuthRows,
} from "../sessions.ts";
import { describeLoginMethods } from "./login-methods.ts";
import { buildInviteMethods } from "./mail.ts";
import { ENGINE_PROVIDER_ID, type ShelfAuthInstance, type ShelfAuthOptions } from "./types.ts";

function toAuthUser(
  sessionUser: { id: string; email: string; name: string; image?: string | null },
  role: AuthUser["role"],
  displayName: string | null,
): AuthUser {
  return {
    id: sessionUser.id,
    email: sessionUser.email,
    // Empty overrides fall back (writes normalize "" to null, but legacy
    // rows may still hold one).
    name: displayName === "" || displayName === null ? sessionUser.name : displayName,
    avatarUrl: sessionUser.image ?? undefined,
    role,
    providerId: ENGINE_PROVIDER_ID,
  };
}

export async function mirrorUser(
  db: DatabaseAdapter,
  created: unknown,
  hooks: Pick<ShelfAuthOptions, "onAuthSystemEvent" | "logger">,
): Promise<void> {
  const user = created as { id: string; email: string; name: string; image?: string | null };
  // Never demote: an engine row created for a staged invitee (admin role)
  // would otherwise overwrite the role with the default.
  const existing = await new UserModel(db).get(user.id);
  await new UserModel(db).upsert({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.image ?? null,
    role: existing?.role ?? "member",
  });
  if (existing) {
    return;
  }
  try {
    await hooks.onAuthSystemEvent?.("sys:user-created", {
      userId: user.id,
      email: user.email,
      name: user.name,
    });
  } catch (error) {
    hooks.logger?.warn({ err: error, userId: user.id }, "auth system hook failed");
  }
}

async function resolveAuthUser(
  shelf: ShelfAuthInstance,
  db: DatabaseAdapter,
  request: Request,
): Promise<AuthUser | null> {
  const result = await shelf.api.getSession({ headers: request.headers });
  if (!result?.user) {
    return null;
  }
  const stored = await new UserModel(db).get(result.user.id);
  // Disabled accounts lose their sessions immediately (no cookie cache, so
  // this check runs on every request). A missing row is a mirror-race, not
  // a disable: keep the member fallback.
  if (stored?.disabled) {
    return null;
  }
  // Refresh IdP-sourced profile fields on drift only (writes are rare: just
  // when the provider profile changes). The user-edited display name lives
  // in displayNameOverride and is never clobbered.
  if (
    stored &&
    (stored.name !== result.user.name ||
      stored.email !== result.user.email ||
      (stored.avatarUrl ?? null) !== (result.user.image ?? null))
  ) {
    await db.update(db.tables.users, stored.id, {
      name: result.user.name,
      email: result.user.email,
      avatarUrl: result.user.image ?? null,
    });
  }
  return toAuthUser(
    {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      image: result.user.image,
    },
    stored?.role ?? "member",
    stored?.displayNameOverride ?? null,
  );
}

async function revokeSession(
  db: DatabaseAdapter,
  shelf: ShelfAuthInstance,
  sessionToken: string,
): Promise<void> {
  if (sessionToken === "") {
    return;
  }
  // Table delete by raw token (accepts the signed cookie value): row removal
  // invalidates the cookie since session reads are DB-backed with no cache.
  await deleteSessionByToken(db, sessionToken);
  await shelf.api
    .signOut({ headers: new Headers({ cookie: `${SESSION_COOKIE}=${sessionToken}` }) })
    .catch(() => {}); // Intentionally empty — table delete above is the revocation
}

async function setUserDisabled(
  db: DatabaseAdapter,
  userId: string,
  disabled: boolean,
): Promise<void> {
  await db.update(db.tables.users, userId, { disabled });
  if (disabled) {
    await deleteUserSessions(db, userId);
  }
}

/** Auth singleton: session reads, revocation, invites, and descriptors. */
export function buildAdapter(
  shelf: ShelfAuthInstance,
  db: DatabaseAdapter,
  options: ShelfAuthOptions,
): Auth {
  return {
    hostSessionCookie: options.hostSessionCookie === true,
    handler: async (request: Request): Promise<Response> => await shelf.handler(request),
    loginMethods: (): EngineLoginMethod[] => describeLoginMethods(options),
    // eslint-disable-next-line require-await -- Auth.setup is async; validation is sync
    setup: async () => {
      // Better Auth merely warns on short secrets; the shelf fails fast
      // (32 chars ≈ 128+ bits for generated values; forgeable cookies else).
      if (options.secret.length < 32) {
        throw new Error("Shelf auth requires a secret of at least 32 characters");
      }
    },
    ...buildInviteMethods(db, options),
    passkeysEnabled: () => options.passkeys !== undefined,
    listSessions: async (userId) => await listUserSessions(db, userId),
    listPasskeys: async (userId) => await listUserPasskeys(db, userId),
    hasPassword: async (userId) => await hasPasswordCredential(db, userId),
    setDisabled: async (userId, disabled) => {
      await setUserDisabled(db, userId, disabled);
    },
    check: async (request: Request): Promise<AuthUser | null> =>
      await resolveAuthUser(shelf, db, request),
    // eslint-disable-next-line require-await -- interface is async; minting forbidden by design
    createSession: async (): Promise<string> => {
      throw new Error(
        "Shelf auth sessions are minted by engine endpoints only; mount auth.handler at /api/auth/*.",
      );
    },
    destroySession: async (sessionToken: string): Promise<void> => {
      await revokeSession(db, shelf, sessionToken);
    },
    purgeExpired: async (cutoffIso) => await purgeExpiredAuthRows(db, cutoffIso),
  };
}
