import {
  SESSION_COOKIE,
  hasPasswordLogin,
  hasSsoLogin,
  isMultiAuth,
  type AuthAdapter,
  type AuthUser,
  type MultiAuthMethod,
  type PasswordLoginAuth,
  type SsoLoginAuth,
} from "@storyshelf/core/adapter/auth";
import { UserModel } from "@storyshelf/core/models";
import { randomToken } from "@storyshelf/core/utils";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ShelfRouter } from "../app-types.ts";
import { renderInviteInvalidPage, renderInvitePage } from "../pages/invite.tsx";
import { renderLoginPage, type SsoProviderLink } from "../pages/login.tsx";
import { getStore } from "../store.ts";
import { syncLoginMemberships } from "./auth-sync.ts";
import { hxRedirect } from "./htmx.ts";

const OAUTH_STATE_COOKIE = "storyshelf_oauth_state";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const SHARED_USER: AuthUser = { id: "shared", email: "admin@local", name: "Admin", role: "admin" };

/** One SSO method addressable at `/auth/login/:id`. */
interface SsoMethod {
  id: string;
  label: string;
  adapter: SsoLoginAuth;
}

function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// oxlint-disable-next-line unicorn/no-useless-undefined -- optional state key per provider
function stateCookieName(providerId?: string): string {
  return providerId ? `${OAUTH_STATE_COOKIE}_${providerId}` : OAUTH_STATE_COOKIE;
}

function validProviderId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/u.test(value);
}

function readCookie(c: Context, name: string): string | undefined {
  const header = c.req.header("cookie");
  if (!header) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return undefined;
}

function setCookieHeader(
  c: Context,
  name: string,
  value: string,
  extra?: { append: boolean },
): void {
  const header = `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`;
  if (extra?.append) {
    c.header("set-cookie", header, { append: true });
  } else {
    c.header("set-cookie", header);
  }
}

/** Every SSO method on an adapter (composite members or the adapter itself). */
function ssoMethods(auth: AuthAdapter): SsoMethod[] {
  if (isMultiAuth(auth)) {
    return auth
      .methods()
      .filter((method): method is MultiAuthMethod & { adapter: SsoLoginAuth } =>
        hasSsoLogin(method.adapter),
      )
      .map((method) => ({ id: method.id, label: method.label, adapter: method.adapter }));
  }
  return hasSsoLogin(auth) ? [{ id: "sso", label: "SSO", adapter: auth }] : [];
}

/** First password-capable method, tagged for composite session minting. */
function passwordMethod(auth: AuthAdapter): {
  adapter: PasswordLoginAuth;
  providerId?: string;
} | null {
  if (isMultiAuth(auth)) {
    const found = auth.methods().find((method) => hasPasswordLogin(method.adapter));
    if (found && hasPasswordLogin(found.adapter)) {
      return { adapter: found.adapter, providerId: found.id };
    }
    return null;
  }
  return hasPasswordLogin(auth) ? { adapter: auth } : null;
}

type AccountLoginAuth = AuthAdapter & {
  loginWithCredentials(email: string, password: string): Promise<string>;
  issueInvite?(input: { email: string; name: string; role: AuthUser["role"] }): Promise<{
    inviteId: string;
    token: string;
    expiresAt: string;
  }>;
  acceptInvite?(input: { inviteId: string; token: string; password: string }): Promise<AuthUser>;
};

function hasAccountLogin(auth: AuthAdapter): auth is AccountLoginAuth {
  return "loginWithCredentials" in auth;
}

function accountMethod(
  auth: AuthAdapter,
): { adapter: AccountLoginAuth; providerId?: string } | null {
  if (isMultiAuth(auth)) {
    const found = auth.methods().find((method) => hasAccountLogin(method.adapter));
    if (found && hasAccountLogin(found.adapter)) {
      return { adapter: found.adapter, providerId: found.id };
    }
    return null;
  }
  return hasAccountLogin(auth) ? { adapter: auth } : null;
}

function accountInviteAdapter(auth: AuthAdapter): AccountLoginAuth | null {
  const target = accountMethod(auth);
  if (target?.adapter.acceptInvite) {
    return target.adapter;
  }
  if (hasAccountLogin(auth) && auth.acceptInvite) {
    return auth;
  }
  return null;
}

/** Login-page SSO buttons link at the per-method start route (no cookies yet). */
function loginLinks(auth: AuthAdapter): SsoProviderLink[] {
  return ssoMethods(auth).map((method) => ({
    id: method.id,
    label: method.label,
    url: `/auth/login/${method.id}`,
  }));
}

/** Redirect to the provider, binding the anti-CSRF state to the state key. */
function startSsoLogin(
  c: Context,
  adapter: SsoLoginAuth,
  // oxlint-disable-next-line unicorn/no-useless-undefined -- stateKey absent for single-provider installs
  stateKey?: string,
): Response {
  const state = randomToken("shelf_").value;
  setCookieHeader(c, stateCookieName(stateKey), state);
  return c.redirect(adapter.loginUrl(state));
}

function providerParam(c: Context): string {
  const id = c.req.param("providerId") ?? "";
  if (!validProviderId(id)) {
    throw new HTTPException(400, { message: "Unknown provider" });
  }
  return id;
}

async function persistLogin(c: Context, auth: AuthAdapter, user: AuthUser): Promise<void> {
  await syncLoginMemberships(
    getStore().db,
    {
      users: getStore().db.tables.users,
      projects: getStore().db.tables.projects,
      projectMembers: getStore().db.tables.projectMembers,
      projectGroupMappings: getStore().db.tables.projectGroupMappings,
    },
    user,
  );
  c.header("set-cookie", sessionCookieHeader(await auth.createSession(user)));
}

/** Shared OAuth callback finish: verify state, resolve the user, mint a session. */
async function finishCallback(
  c: Context,
  auth: AuthAdapter,
  method: SsoMethod,
  // oxlint-disable-next-line unicorn/no-useless-undefined -- stateKey absent for single-provider installs
  stateKey: string | undefined,
): Promise<Response> {
  const code = c.req.query("code") ?? "";
  const state = c.req.query("state") ?? "";
  if (!code || !state) {
    throw new HTTPException(400, { message: "Missing code or state" });
  }
  if (readCookie(c, stateCookieName(stateKey)) !== state) {
    throw new HTTPException(400, { message: "Invalid state" });
  }
  const user = method.adapter.handleCallback
    ? await method.adapter.handleCallback({ provider: "oidc", providerId: method.id, code, state })
    : null;
  if (!user) {
    return c.html(
      await renderLoginPage({ error: "SSO sign in failed", ssoProviders: loginLinks(auth) }),
      401,
    );
  }
  await persistLogin(c, auth, user);
  setCookieHeader(c, stateCookieName(stateKey), "; Max-Age=0", { append: true });
  return c.redirect("/");
}

/** Register the password and SSO login, callback, and logout routes. */
// oxlint-disable-next-line eslint/max-lines-per-function -- route registration is cohesive
export function registerAuth(app: ShelfRouter, auth: AuthAdapter): void {
  app.get("/auth/login", async (c) => {
    const methods = ssoMethods(auth);
    const hasPassword = passwordMethod(auth) !== null;
    const hasAccount = accountMethod(auth) !== null;
    if (isMultiAuth(auth)) {
      const sole = methods.length === 1 ? methods.at(0) : undefined;
      if (!hasPassword && !hasAccount && sole) {
        return c.redirect(`/auth/login/${sole.id}`);
      }
      return c.html(
        await renderLoginPage({
          passwordEnabled: hasPassword,
          accountEnabled: hasAccount,
          ssoProviders: loginLinks(auth),
        }),
      );
    }
    if (hasSsoLogin(auth) && !hasPasswordLogin(auth) && !hasAccountLogin(auth)) {
      return startSsoLogin(c, auth);
    }
    const ssoUrl = hasSsoLogin(auth) ? startSsoUrl(c, auth) : undefined;
    const passwordEnabled = hasPasswordLogin(auth);
    const accountEnabled = hasAccountLogin(auth);
    const showPassword = passwordEnabled || (!hasSsoLogin(auth) && !accountEnabled);
    return c.html(await renderLoginPage({ ssoUrl, passwordEnabled: showPassword, accountEnabled }));
  });

  // oxlint-disable-next-line typescript/promise-function-async -- Hono handler may return Response directly
  app.get("/auth/login/:providerId", (c) => {
    if (!isMultiAuth(auth)) {
      return c.notFound();
    }
    const method = ssoMethods(auth).find((entry) => entry.id === providerParam(c));
    if (!method) {
      return c.notFound();
    }
    return startSsoLogin(c, method.adapter, method.id);
  });

  app.post("/auth/login", async (c) => {
    const target = passwordMethod(auth);
    if (!target) {
      throw new HTTPException(404, { message: "Password login is not configured" });
    }
    const form = await c.req.formData();
    const raw = form.get("password");
    const password = typeof raw === "string" ? raw : "";
    try {
      if (target.providerId) {
        const user: AuthUser = { ...SHARED_USER, providerId: target.providerId };
        await target.adapter.login(password, user);
        await new UserModel(getStore().db).upsert({
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl ?? null,
          role: user.role,
          authProvider: "shared",
        });
        c.header("set-cookie", sessionCookieHeader(await auth.createSession(user)));
      } else {
        const token = await target.adapter.login(password, SHARED_USER);
        await new UserModel(getStore().db).upsert({
          id: SHARED_USER.id,
          email: SHARED_USER.email,
          name: SHARED_USER.name,
          avatarUrl: SHARED_USER.avatarUrl ?? null,
          role: SHARED_USER.role,
          authProvider: "shared",
        });
        c.header("set-cookie", sessionCookieHeader(token));
      }
      return hxRedirect(c, "/");
    } catch {
      return c.html(
        await renderLoginPage({
          error: "Invalid password",
          ssoProviders: loginLinks(auth),
          accountEnabled: accountMethod(auth) !== null,
        }),
        401,
      );
    }
  });

  app.post("/auth/account/login", async (c) => {
    const target = accountMethod(auth);
    if (!target) {
      throw new HTTPException(404, { message: "Account login is not configured" });
    }
    const form = await c.req.formData();
    const rawEmail = form.get("email");
    const rawPassword = form.get("password");
    const email = typeof rawEmail === "string" ? rawEmail : "";
    const password = typeof rawPassword === "string" ? rawPassword : "";
    try {
      const token = await target.adapter.loginWithCredentials(email, password);
      // If composite, re-mint via composite secret so check works via composite path.
      const maybeUser = await target.adapter.check(
        new Request("https://example.com/", { headers: { cookie: `${SESSION_COOKIE}=${token}` } }),
      );
      if (maybeUser && target.providerId) {
        const tagged: AuthUser = { ...maybeUser, providerId: target.providerId };
        c.header("set-cookie", sessionCookieHeader(await auth.createSession(tagged)));
      } else {
        c.header("set-cookie", sessionCookieHeader(token));
      }
      return hxRedirect(c, "/");
    } catch {
      return c.html(
        await renderLoginPage({
          error: "Invalid credentials",
          accountEnabled: true,
          passwordEnabled: passwordMethod(auth) !== null,
          ssoProviders: loginLinks(auth),
          email,
        }),
        401,
      );
    }
  });

  app.get("/auth/invites/:inviteId", async (c) => {
    const inviteId = c.req.param("inviteId") ?? "";
    const token = c.req.query("token") ?? "";
    if (!inviteId || !token) {
      return c.html(renderInviteInvalidPage("Missing invite link parameters"), 400);
    }
    const adapter = accountInviteAdapter(auth);
    if (!adapter) {
      return c.html(renderInviteInvalidPage("Account sign-up is not configured"), 404);
    }
    try {
      const db = getStore().db;
      const invite = (await db.get(db.tables.userInviteTokens, inviteId)) as unknown as {
        userId: string;
        tokenHash: string;
        expiresAt: string;
        usedAt: string | null;
      } | null;
      if (!invite || invite.usedAt) {
        return c.html(renderInviteInvalidPage("Invalid or expired invite"), 400);
      }
      if (new Date(invite.expiresAt).getTime() <= Date.now()) {
        return c.html(renderInviteInvalidPage("Invalid or expired invite"), 400);
      }
      const { sha256 } = await import("@storyshelf/core/utils");
      if (sha256(token) !== invite.tokenHash) {
        return c.html(renderInviteInvalidPage("Invalid or expired invite"), 400);
      }
      const user = (await db.get(db.tables.users, invite.userId)) as unknown as {
        email: string;
        name: string;
      } | null;
      return c.html(
        await renderInvitePage({
          inviteId,
          token,
          email: user?.email,
          name: user?.name,
        }),
      );
    } catch {
      return c.html(renderInviteInvalidPage("Invalid or expired invite"), 400);
    }
  });

  app.post("/auth/invites/:inviteId", async (c) => {
    const inviteId = c.req.param("inviteId") ?? "";
    const form = await c.req.formData();
    const rawToken = form.get("token");
    const rawPassword = form.get("password");
    const rawConfirm = form.get("confirm");
    const token = typeof rawToken === "string" ? rawToken : "";
    const password = typeof rawPassword === "string" ? rawPassword : "";
    const confirm = typeof rawConfirm === "string" ? rawConfirm : "";
    if (!inviteId || !token) {
      return c.html(renderInviteInvalidPage("Missing invite link parameters"), 400);
    }
    if (password !== confirm) {
      return c.html(
        await renderInvitePage({ inviteId, token, error: "Passwords do not match" }),
        400,
      );
    }
    const adapter = accountInviteAdapter(auth);
    if (!adapter?.acceptInvite) {
      return c.html(renderInviteInvalidPage("Account sign-up is not configured"), 404);
    }
    try {
      const user = await adapter.acceptInvite({ inviteId, token, password });
      const tagged: AuthUser = accountMethod(auth)?.providerId
        ? { ...user, providerId: accountMethod(auth)?.providerId }
        : user;
      await syncLoginMemberships(
        getStore().db,
        {
          users: getStore().db.tables.users,
          projects: getStore().db.tables.projects,
          projectMembers: getStore().db.tables.projectMembers,
          projectGroupMappings: getStore().db.tables.projectGroupMappings,
        },
        tagged,
      );
      c.header("set-cookie", sessionCookieHeader(await auth.createSession(tagged)));
      return c.redirect("/profile");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid or expired invite";
      if (message.includes("at least 12")) {
        return c.html(await renderInvitePage({ inviteId, token, error: message }), 400);
      }
      return c.html(renderInviteInvalidPage(message), 400);
    }
  });

  app.get("/auth/callback/:providerId", async (c) => {
    if (!isMultiAuth(auth)) {
      return c.notFound();
    }
    const method = ssoMethods(auth).find((entry) => entry.id === providerParam(c));
    if (!method?.adapter.handleCallback) {
      return c.notFound();
    }
    return finishCallback(c, auth, method, method.id);
  });

  app.get("/auth/callback", async (c) => {
    if (isMultiAuth(auth)) {
      const capable = ssoMethods(auth).filter(
        // oxlint-disable-next-line typescript/unbound-method -- handler is arrow-bound, no this
        (method) => method.adapter.handleCallback,
      );
      const sole = capable.length === 1 ? capable.at(0) : undefined;
      if (!sole) {
        throw new HTTPException(400, { message: "Unknown provider" });
      }
      return finishCallback(c, auth, sole, sole.id);
    }
    // oxlint-disable-next-line typescript/unbound-method -- interface method, no this
    if (!auth.handleCallback) {
      return c.notFound();
    }
    const code = c.req.query("code") ?? "";
    const state = c.req.query("state") ?? "";
    if (!code || !state) {
      throw new HTTPException(400, { message: "Missing code or state" });
    }
    // oxlint-disable-next-line typescript/unbound-method -- interface method, no this
    const user = await auth.handleCallback({ provider: "oidc", code, state });
    if (!user) {
      return c.html(await renderLoginPage({ error: "SSO sign in failed" }), 401);
    }
    await persistLogin(c, auth, user);
    return c.redirect("/");
  });

  app.post("/auth/logout", async (c) => {
    await auth.destroySession("");
    c.header("set-cookie", clearSessionCookieHeader());
    return hxRedirect(c, "/auth/login");
  });
}

function startSsoUrl(c: Context, auth: SsoLoginAuth): string {
  const state = randomToken("shelf_").value;
  setCookieHeader(c, stateCookieName(), state);
  return auth.loginUrl(state);
}
