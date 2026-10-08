import type { Auth } from "@storyshelf/core/auth";
import { MIN_PASSWORD_LENGTH, unsignedToken } from "@storyshelf/core/auth";
import { NotificationSubscriptionModel, ProjectModel, UserModel } from "@storyshelf/core/models";
import { eq, getTableColumns } from "@storyshelf/core/orm";
import type { Project } from "@storyshelf/core/schema";
import { SESSION_COOKIE, type AuthUser } from "@storyshelf/core/types";
import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { renderProfilePage } from "../pages/profile.tsx";
import { getStore } from "../store.ts";
import { forwardToEngine } from "./auth.ts";
import { flash } from "./flash.ts";
import { hxRedirect } from "./htmx.ts";

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
  userRow: ProfileRow | null;
  memberships: ProfileMembership[];
  subscribedSlugs: string[];
}> {
  const { db } = getStore();
  const userRow = (await new UserModel(db).get(userId)) as unknown as ProfileRow | null;
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
  const subs = await new NotificationSubscriptionModel(db).listForUser(userId);
  const subscribedIds = new Set(subs.filter((sub) => sub.enabled).map((sub) => sub.projectId));
  const subscribedSlugs = [...byId.values()]
    .filter((project) => subscribedIds.has(project.id))
    .map((project) => project.slug);
  return { userRow, memberships, subscribedSlugs };
}

function readSessionToken(c: Context): string {
  const header = c.req.header("cookie") ?? "";
  for (const part of header.split(";")) {
    const eqIndex = part.indexOf("=");
    if (eqIndex !== -1 && part.slice(0, eqIndex).trim() === SESSION_COOKIE) {
      // Engine cookies are signed (`token.signature`); the table holds the raw token.
      return unsignedToken(part.slice(eqIndex + 1).trim());
    }
  }
  return "";
}

/** Engine security overview for the profile page. */
async function loadEngineSecurity(
  c: Context,
  auth: Auth,
  user: AuthUser,
): Promise<NonNullable<ProfilePage["security"]>> {
  const [sessions, passkeys, hasPassword] = await Promise.all([
    auth.listSessions(user.id),
    auth.listPasskeys(user.id),
    auth.hasPassword(user.id),
  ]);
  const current = readSessionToken(c);
  return {
    sessions: sessions.map((session) => ({
      id: session.id,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      current: session.token === current,
    })),
    passkeys,
    passkeysEnabled: auth.passkeysEnabled(),
    hasPassword,
  };
}

async function profileView(
  c: Context,
  user: AuthUser,
  auth: Auth,
  extra?: { error?: string; success?: string; local?: boolean; status?: 200 | 400 },
): Promise<Response> {
  const { userRow, memberships, subscribedSlugs } = await loadProfileData(user.id);
  const security = await loadEngineSecurity(c, auth, user);
  const html = await renderProfilePage({
    user,
    dbUser: toDbUser(userRow),
    memberships,
    subscribedSlugs,
    isLocal: extra?.local ?? security.hasPassword,
    security,
    error: extra?.error,
  });
  if (extra?.success) {
    flash(c, extra.success);
  }
  // Device tokens render into the page (per-device revoke forms): never store.
  c.header("Cache-Control", "no-store");
  return c.html(html, extra?.status ?? 200);
}

/** Register the personal profile page and its mutations. */
export function registerProfile(app: ShelfRouter, auth: Auth): void {
  app.get("/profile", async (c) => {
    const { user } = getStore();
    if (!user) {
      return c.redirect("/auth/login", 302);
    }
    return await profileView(c, user, auth);
  });

  app.post("/profile", async (c) => {
    const { user } = getStore();
    if (!user) {
      return c.redirect("/auth/login", 302);
    }
    const displayName = field(await c.req.formData(), "displayName").trim();
    if (!displayName) {
      return profileView(c, user, auth, { error: "Display name is required", status: 400 });
    }
    await new UserModel(getStore().db).setDisplayNameOverride(user.id, displayName);
    flash(c, "Profile updated");
    return hxRedirect(c, "/profile");
  });

  registerPasswordRoute(app, auth);
  registerSessionRoutes(app, auth);
  registerPasskeyRoutes(app, auth);
  registerNotificationsRoute(app, auth);
}

function registerNotificationsRoute(app: ShelfRouter, auth: Auth): void {
  app.post("/profile/notifications", async (c) => {
    const { user } = getStore();
    if (!user) {
      return c.redirect("/auth/login", 302);
    }
    return await saveProfileNotifications(c, user, auth);
  });
}

/** Toggle the viewer's own email subscription for one member project. */
async function saveProfileNotifications(c: Context, user: AuthUser, auth: Auth): Promise<Response> {
  const form = await c.req.formData();
  const project = await memberProject(field(form, "slug"), user.id);
  if (!project) {
    return profileView(c, user, auth, { error: "Unknown project", status: 400 });
  }
  await applyProfileToggle(project.id, user.id, field(form, "enabled") === "1");
  flash(c, "Notification preference saved");
  return hxRedirect(c, "/profile");
}

/** Resolve a project the viewer belongs to (null otherwise). */
async function memberProject(slug: string, userId: string): Promise<Project | null> {
  const project = await new ProjectModel(getStore().db).getBySlug(slug);
  if (!project) {
    return null;
  }
  const { memberships } = await loadProfileData(userId);
  const isMember = memberships.some((membership) => membership.projectSlug === slug);
  return isMember ? project : null;
}

/** Enable (opt-in email) or disable (remove) a subscription. */
async function applyProfileToggle(
  projectId: string,
  userId: string,
  enable: boolean,
): Promise<void> {
  const model = new NotificationSubscriptionModel(getStore().db);
  if (enable) {
    await model.upsert(projectId, userId, { via: ["email"] });
    return;
  }
  await model.remove(projectId, userId);
}

function registerPasswordRoute(app: ShelfRouter, auth: Auth): void {
  app.post("/profile/password", async (c) => {
    const { user } = getStore();
    if (!user) {
      return c.redirect("/auth/login", 302);
    }
    return await handleEnginePasswordChange(c, auth, user);
  });
}

function registerSessionRoutes(app: ShelfRouter, auth: Auth): void {
  app.post("/profile/sessions/revoke", async (c) => {
    const { user } = getStore();
    if (!user) {
      return c.redirect("/auth/login", 302);
    }
    return await handleSessionRevoke(c, auth, user);
  });

  app.post("/profile/sessions/revoke-others", async (c) => {
    const { user } = getStore();
    if (!user) {
      return c.redirect("/auth/login", 302);
    }
    return await handleRevokeOthers(c, auth, user);
  });
}

function registerPasskeyRoutes(app: ShelfRouter, auth: Auth): void {
  app.post("/profile/passkeys/:passkeyId/delete", async (c) => {
    const { user } = getStore();
    if (!user) {
      return c.redirect("/auth/login", 302);
    }
    return await handlePasskeyDelete(c, auth, user);
  });
}

async function handleSessionRevoke(c: Context, auth: Auth, user: AuthUser): Promise<Response> {
  const id = await readSessionId(c);
  if (!id) {
    return profileView(c, user, auth, { error: "Missing session", status: 400 });
  }
  const token = await resolveSessionToken(auth, user, id);
  if (!token) {
    return profileView(c, user, auth, { error: "Could not revoke that session", status: 400 });
  }
  const res = await forwardToEngine(c, auth, "/api/auth/revoke-session", { token });
  if (res.status !== 200) {
    return profileView(c, user, auth, { error: "Could not revoke that session", status: 400 });
  }
  return profileView(c, user, auth, { success: "Session revoked" });
}

async function readSessionId(c: Context): Promise<string> {
  return field(await c.req.formData(), "sessionId");
}

async function resolveSessionToken(auth: Auth, user: AuthUser, id: string): Promise<string | null> {
  const sessions = await auth.listSessions(user.id);
  return sessions.find((session) => session.id === id)?.token ?? null;
}

async function handleRevokeOthers(c: Context, auth: Auth, user: AuthUser): Promise<Response> {
  const res = await forwardToEngine(c, auth, "/api/auth/revoke-other-sessions", {});
  if (res.status !== 200) {
    return profileView(c, user, auth, { error: "Could not sign out other devices", status: 400 });
  }
  return profileView(c, user, auth, { success: "Signed out of other devices" });
}

async function handlePasskeyDelete(c: Context, auth: Auth, user: AuthUser): Promise<Response> {
  const id = c.req.param("passkeyId") ?? "";
  if (!/^[A-Za-z0-9_-]{1,64}$/u.test(id)) {
    return profileView(c, user, auth, { error: "Unknown passkey", status: 400 });
  }
  const res = await forwardToEngine(c, auth, "/api/auth/passkey/delete-passkey", { id });
  if (res.status !== 200) {
    return profileView(c, user, auth, { error: "Could not remove that passkey", status: 400 });
  }
  return profileView(c, user, auth, { success: "Passkey removed" });
}

async function engineErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown };
    return typeof body.message === "string" && body.message ? body.message : fallback;
  } catch {
    return fallback;
  }
}

/** Validate the password form and change it through the engine. */
async function handleEnginePasswordChange(
  c: Context,
  auth: Auth,
  user: AuthUser,
): Promise<Response> {
  const { current, next, error } = readPasswordChange(await c.req.formData());
  if (error) {
    return profileView(c, user, auth, { error, local: true, status: 400 });
  }
  const res = await forwardToEngine(c, auth, "/api/auth/change-password", {
    currentPassword: current,
    newPassword: next,
    revokeOtherSessions: true,
  });
  if (res.status !== 200) {
    const message = await engineErrorMessage(res, "Password change failed");
    return profileView(c, user, auth, { error: message, local: true, status: 400 });
  }
  return profileView(c, user, auth, { success: "Password changed", local: true });
}

function readPasswordChange(form: FormData): { current: string; next: string; error?: string } {
  const next = field(form, "newPassword");
  if (next !== field(form, "confirmPassword")) {
    return { current: "", next: "", error: "Passwords do not match" };
  }
  if (next.length < MIN_PASSWORD_LENGTH) {
    return {
      current: "",
      next: "",
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    };
  }
  return { current: field(form, "currentPassword"), next };
}
