import type { AuthUser } from "@storyshelf/core/adapter/auth";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { UserModel } from "@storyshelf/core/models";
import { eq, getTableColumns } from "drizzle-orm";
import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { renderProfilePage } from "../pages/profile.tsx";
import { getStore } from "../store.ts";
import { hxRedirect } from "./htmx.ts";
import {
  PROFILE_MIN_PASSWORD_LENGTH,
  hashProfilePassword,
  verifyProfilePassword,
} from "./profile-password.ts";

/** User columns needed to render the profile page. */
interface ProfileRow {
  email: string;
  name: string;
  displayNameOverride: string | null;
  authProvider: string;
  lastLoginAt: string | null;
  createdAt: string;
}

/** Membership entry for the profile page. */
interface ProfileMembership {
  projectName: string;
  projectSlug: string;
  role: string;
  source: string;
}

function field(form: FormData, name: string): string {
  const raw = form.get(name);
  return typeof raw === "string" ? raw : "";
}

function toDbUser(row: ProfileRow | null): ProfilePage["dbUser"] {
  if (!row) {
    return undefined;
  }
  return {
    email: row.email,
    name: row.name,
    displayNameOverride: row.displayNameOverride,
    authProvider: row.authProvider,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
  };
}

type ProfilePage = Parameters<typeof renderProfilePage>[0];

async function loadProfileData(userId: string): Promise<{
  userRow: (ProfileRow & { passwordHash: string | null }) | null;
  memberships: ProfileMembership[];
}> {
  const { db } = getStore();
  const userRow = (await new UserModel(db).get(userId)) as unknown as
    | (ProfileRow & { passwordHash: string | null })
    | null;
  const members = (await db.list(db.tables.projectMembers, {
    where: eq(getTableColumns(db.tables.projectMembers)["userId"] as never, userId),
  })) as unknown as Array<{ projectId: string; role: string; source: string }>;
  const projects = (await db.list(db.tables.projects)) as unknown as Array<{
    id: string;
    name: string;
    slug: string;
  }>;
  const byId = new Map(projects.map((project) => [project.id, project]));
  const memberships = members.flatMap((member) => {
    const project = byId.get(member.projectId);
    return project
      ? [
          {
            projectName: project.name,
            projectSlug: project.slug,
            role: member.role,
            source: member.source,
          },
        ]
      : [];
  });
  return { userRow, memberships };
}

function isLocalAccount(user: AuthUser, row: ProfileRow | null): boolean {
  return row?.authProvider === "local" || user.providerId === "account";
}

async function profileView(
  c: Context,
  user: AuthUser,
  extra?: { error?: string; success?: string; local?: boolean; status?: 200 | 400 },
): Promise<Response> {
  const { userRow, memberships } = await loadProfileData(user.id);
  const html = await renderProfilePage({
    user,
    dbUser: toDbUser(userRow),
    memberships,
    isLocal: extra?.local ?? isLocalAccount(user, userRow),
    error: extra?.error,
    success: extra?.success,
  });
  return c.html(html, extra?.status ?? 200);
}

/** Change a local-account password; returns an error message or null on success. */
async function changePassword(
  db: DatabaseAdapter,
  userId: string,
  current: string,
  next: string,
): Promise<string | null> {
  const row = (await db.get(db.tables.users, userId)) as unknown as {
    passwordHash: string | null;
  } | null;
  if (!row?.passwordHash) {
    return "Password change is only available for local accounts";
  }
  if (!(await verifyProfilePassword(current, row.passwordHash))) {
    return "Current password is incorrect";
  }
  const hash = await hashProfilePassword(next);
  await db.update(db.tables.users, userId, { passwordHash: hash });
  return null;
}

/** Register the personal profile page and its mutations. */
export function registerProfile(app: ShelfRouter): void {
  app.get("/profile", async (c) => {
    const { user } = getStore();
    if (!user) {
      return c.redirect("/auth/login", 302);
    }
    return await profileView(c, user);
  });

  app.post("/profile", async (c) => {
    const { user } = getStore();
    if (!user) {
      return c.redirect("/auth/login", 302);
    }
    const displayName = field(await c.req.formData(), "displayName").trim();
    if (!displayName) {
      return profileView(c, user, { error: "Display name is required", status: 400 });
    }
    await new UserModel(getStore().db).setDisplayNameOverride(user.id, displayName);
    return hxRedirect(c, "/profile");
  });

  app.post("/profile/password", async (c) => {
    const { user } = getStore();
    if (!user) {
      return c.redirect("/auth/login", 302);
    }
    return await handlePasswordChange(c, user);
  });
}

/** Validate the password form and apply the change. */
async function handlePasswordChange(c: Context, user: AuthUser): Promise<Response> {
  const form = await c.req.formData();
  const next = field(form, "newPassword");
  if (next !== field(form, "confirmPassword")) {
    return profileView(c, user, { error: "Passwords do not match", local: true, status: 400 });
  }
  if (next.length < PROFILE_MIN_PASSWORD_LENGTH) {
    return profileView(c, user, {
      error: `Password must be at least ${PROFILE_MIN_PASSWORD_LENGTH} characters`,
      local: true,
      status: 400,
    });
  }
  const failure = await changePassword(
    getStore().db,
    user.id,
    field(form, "currentPassword"),
    next,
  );
  if (failure) {
    return profileView(c, user, { error: failure, local: true, status: 400 });
  }
  return profileView(c, user, { success: "Password changed", local: true });
}
