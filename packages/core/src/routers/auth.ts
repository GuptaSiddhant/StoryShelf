import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ShelfApp } from "../index.tsx";

import { SESSION_COOKIE, type AuthAdapter, type AuthUser } from "../adapters/auth.ts";
import { renderLoginPage } from "../pages/login.tsx";
import { randomToken } from "../utils/hash.ts";
import { hxRedirect } from "./htmx.ts";

const OAUTH_STATE_COOKIE = "storyshelf_oauth_state";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const SHARED_USER: AuthUser = { id: "shared", email: "admin@local", name: "Admin", role: "admin" };

function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

type PasswordAuth = AuthAdapter & { login(password: string, user: AuthUser): Promise<string> };
type SsoAuth = AuthAdapter & { loginUrl(state: string): string };

function hasPasswordLogin(auth: AuthAdapter): auth is PasswordAuth {
  return "login" in auth;
}

function hasSso(auth: AuthAdapter): auth is SsoAuth {
  return "loginUrl" in auth;
}

function buildSsoUrl(c: Context, auth: SsoAuth): string {
  const state = randomToken("shelf_").value;
  c.header("set-cookie", `${OAUTH_STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);
  return auth.loginUrl(state);
}

export function registerAuth(app: ShelfApp, auth: AuthAdapter): void {
  app.get("/auth/login", async (c) => {
    if (hasSso(auth) && !hasPasswordLogin(auth)) {
      return c.redirect(buildSsoUrl(c, auth));
    }
    const ssoUrl = hasSso(auth) ? buildSsoUrl(c, auth) : undefined;
    return c.html(await renderLoginPage({ ssoUrl }));
  });

  app.post("/auth/login", async (c) => {
    if (!hasPasswordLogin(auth)) {
      throw new HTTPException(404, { message: "Password login is not configured" });
    }
    const form = await c.req.formData();
    const raw = form.get("password");
    const password = typeof raw === "string" ? raw : "";
    try {
      const token = await auth.login(password, SHARED_USER);
      c.header("set-cookie", sessionCookieHeader(token));
      return hxRedirect(c, "/");
    } catch {
      return c.html(await renderLoginPage({ error: "Invalid password" }), 401);
    }
  });

  app.get("/auth/callback", async (c) => {
    if (!auth.handleCallback) {
      return c.notFound();
    }
    const code = c.req.query("code") ?? "";
    const state = c.req.query("state") ?? "";
    if (!code || !state) {
      throw new HTTPException(400, { message: "Missing code or state" });
    }
    const user = await auth.handleCallback({ provider: "oidc", code, state });
    if (!user) {
      return c.html(await renderLoginPage({ error: "SSO sign in failed" }), 401);
    }
    const token = await auth.createSession(user);
    c.header("set-cookie", sessionCookieHeader(token));
    return c.redirect("/");
  });

  app.post("/auth/logout", async (c) => {
    await auth.destroySession("");
    c.header("set-cookie", clearSessionCookieHeader());
    return hxRedirect(c, "/auth/login");
  });
}