import type { Auth, EngineLoginMethod } from "@storyshelf/auth";
import { MIN_PASSWORD_LENGTH } from "@storyshelf/auth";
import { UserModel } from "@storyshelf/core/models";
import { SESSION_COOKIE } from "@storyshelf/core/types";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ShelfRouter } from "../app-types.ts";
import { renderInviteInvalidPage, renderInvitePage } from "../pages/invite.tsx";
import { renderLoginPage } from "../pages/login.tsx";
import { getStore } from "../store.ts";
import { syncLoginMemberships } from "./auth-sync.ts";
import { hxRedirect } from "./htmx.ts";

/** Provider ids are URL path segments: strict charset, bounded length. */
function validProviderId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/u.test(value);
}

const ENGINE_PASSWORD_ACTION = "/auth/engine/login";

/** Forward a request to the mounted engine, preserving origin and cookies. */
export async function forwardToEngine(
  c: Context,
  engine: Auth,
  path: string,
  body?: unknown,
): Promise<Response> {
  return await forwardEngineRequest(c, engine, path, "POST", body);
}

async function forwardEngineRequest(
  c: Context,
  engine: Auth,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<Response> {
  const headers = new Headers();
  for (const name of ["cookie", "origin", "referer", "user-agent"]) {
    const value = c.req.header(name);
    if (value) {
      headers.set(name, value);
    }
  }
  if (method === "POST") {
    headers.set("content-type", "application/json");
  }
  return await engine.handler(
    new Request(new URL(path, c.req.url), {
      method,
      headers,
      ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
    }),
  );
}

function copySetCookies(c: Context, res: Response): void {
  const cookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : splitSetCookie(res.headers.get("set-cookie"));
  for (const cookie of cookies) {
    c.header("set-cookie", cookie, { append: true });
  }
}

/** Split a joined Set-Cookie header (runtimes without getSetCookie). */
function splitSetCookie(header: string | null): string[] {
  if (!header) {
    return [];
  }
  // Split on commas starting a new `name=` pair; Expires dates ("Wed, 21")
  // never match (no `=` after the token). Fallback only — Node has getSetCookie.
  return header
    .split(/,\s*(?=[^;\s=]+=)/u)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

function loginLinks(
  methods: EngineLoginMethod[],
): { kind: "password" | "oauth" | "passkey" | "sso"; id: string; label: string; url: string }[] {
  return methods.map((method) => ({
    ...method,
    // Passkey sign-in is JS-driven on the page; the url is an unused fallback.
    url:
      method.kind === "oauth" || method.kind === "sso"
        ? `/auth/engine/${method.id}`
        : ENGINE_PASSWORD_ACTION,
  }));
}

async function renderEngineLogin(
  c: Context,
  engine: Auth,
  error?: string,
  email?: string,
  status?: 200 | 401 | 429 | 500 | 502,
): Promise<Response> {
  return c.html(
    await renderLoginPage({
      error,
      email,
      engineMethods: loginLinks(engine.loginMethods()),
    }),
    status ?? 200,
  );
}

/** Membership sync for first-seen engine users only (never demote existing roles). */
async function syncEngineUser(user: { id: string; email: string; name: string }): Promise<void> {
  const existing = await new UserModel(getStore().db).get(user.id);
  if (existing) {
    return;
  }
  await syncLoginMemberships(
    getStore().db,
    {
      users: getStore().db.tables.users,
      projects: getStore().db.tables.projects,
      projectMembers: getStore().db.tables.projectMembers,
      projectGroupMappings: getStore().db.tables.projectGroupMappings,
    },
    { ...user, role: "member" },
  );
}

async function readCredentials(c: Context): Promise<{ email: string; password: string }> {
  const form = await c.req.formData();
  const rawEmail = form.get("email");
  const rawPassword = form.get("password");
  return {
    email: typeof rawEmail === "string" ? rawEmail : "",
    password: typeof rawPassword === "string" ? rawPassword : "",
  };
}

async function finishCredentialLogin(
  c: Context,
  engine: Auth,
  email: string,
  password: string,
): Promise<Response> {
  const res = await forwardToEngine(c, engine, "/api/auth/sign-in/email", { email, password });
  if (res.status !== 200) {
    // Generic message either way (no user enumeration), but propagate
    // rate-limit/upstream statuses instead of masking them as 401.
    if (res.status === 429) {
      return renderEngineLogin(c, engine, "Invalid credentials", email, 429);
    }
    if (res.status >= 500) {
      return renderEngineLogin(c, engine, "Invalid credentials", email, 502);
    }
    return renderEngineLogin(c, engine, "Invalid credentials", email, 401);
  }
  copySetCookies(c, res);
  const body = (await res.json()) as { user: { id: string; email: string; name: string } };
  await syncEngineUser(body.user);
  return hxRedirect(c, "/");
}

async function handleEngineLogin(c: Context, engine: Auth): Promise<Response> {
  const { email, password } = await readCredentials(c);
  return finishCredentialLogin(c, engine, email, password);
}

function resolveEngineMethod(c: Context, engine: Auth): EngineLoginMethod | null {
  const id = c.req.param("providerId") ?? "";
  if (!validProviderId(id)) {
    throw new HTTPException(400, { message: "Unknown provider" });
  }
  return (
    engine.loginMethods().find((entry) => entry.id === id && entry.kind !== "password") ?? null
  );
}

async function finishOAuthStart(c: Context, engine: Auth, id: string): Promise<Response> {
  const res = await forwardToEngine(c, engine, "/api/auth/sign-in/social", {
    provider: id,
    callbackURL: "/",
    disableRedirect: true,
  });
  if (res.status !== 200) {
    throw new HTTPException(502, { message: "Sign in failed" });
  }
  const body = (await res.json()) as { url?: string };
  if (!body.url) {
    throw new HTTPException(502, { message: "Sign in failed" });
  }
  copySetCookies(c, res);
  return c.redirect(body.url);
}

async function finishSSOStart(c: Context, engine: Auth, id: string): Promise<Response> {
  const res = await forwardToEngine(c, engine, "/api/auth/sign-in/sso", {
    providerId: id,
    callbackURL: "/",
  });
  if (res.status !== 200) {
    throw new HTTPException(502, { message: "Sign in failed" });
  }
  const body = (await res.json()) as { url?: string };
  if (!body.url) {
    throw new HTTPException(502, { message: "Sign in failed" });
  }
  copySetCookies(c, res);
  return c.redirect(body.url);
}

async function handleEngineStart(c: Context, engine: Auth): Promise<Response> {
  const method = resolveEngineMethod(c, engine);
  if (!method || method.kind === "passkey") {
    return c.notFound();
  }
  if (method.kind === "sso") {
    return await finishSSOStart(c, engine, method.id);
  }
  return await finishOAuthStart(c, engine, method.id);
}

async function handleInvitePage(c: Context, engine: Auth): Promise<Response> {
  const inviteId = c.req.param("inviteId") ?? "";
  const token = c.req.query("token") ?? "";
  // The invite token renders into the page: never store.
  c.header("Cache-Control", "no-store");
  if (!inviteId || !token) {
    return c.html(renderInviteInvalidPage("Missing invite link parameters"), 400);
  }
  try {
    const { email, name } = await engine.verifyInvite({ inviteId, token });
    return c.html(await renderInvitePage({ inviteId, token, email, name }));
  } catch {
    return c.html(renderInviteInvalidPage("Invalid or expired invite"), 400);
  }
}

async function readInviteForm(c: Context): Promise<{
  inviteId: string;
  token: string;
  password: string;
  confirm: string;
}> {
  const form = await c.req.formData();
  return {
    inviteId: c.req.param("inviteId") ?? "",
    token: formText(form.get("token")),
    password: formText(form.get("password")),
    confirm: formText(form.get("confirm")),
  };
}

function formText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function finishInviteAccept(
  c: Context,
  engine: Auth,
  inviteId: string,
  token: string,
  password: string,
): Promise<Response> {
  const user = await engine.acceptInvite({ inviteId, token, password });
  const res = await forwardToEngine(c, engine, "/api/auth/sign-in/email", {
    email: user.email,
    password,
  });
  if (res.status !== 200) {
    throw new Error("Sign in failed");
  }
  copySetCookies(c, res);
  await syncEngineUser({ id: user.id, email: user.email, name: user.name });
  return c.redirect("/profile");
}

async function inviteAcceptError(
  c: Context,
  inviteId: string,
  token: string,
  error: unknown,
): Promise<Response> {
  const message = error instanceof Error ? error.message : "Invalid or expired invite";
  if (message.includes(`at least ${MIN_PASSWORD_LENGTH}`)) {
    return c.html(await renderInvitePage({ inviteId, token, error: message }), 400);
  }
  return c.html(renderInviteInvalidPage(message), 400);
}

async function handleInviteAccept(c: Context, engine: Auth): Promise<Response> {
  const { inviteId, token, password, confirm } = await readInviteForm(c);
  if (!inviteId || !token) {
    return c.html(renderInviteInvalidPage("Missing invite link parameters"), 400);
  }
  if (password !== confirm) {
    return c.html(
      await renderInvitePage({ inviteId, token, error: "Passwords do not match" }),
      400,
    );
  }
  try {
    return await finishInviteAccept(c, engine, inviteId, token, password);
  } catch (error) {
    return await inviteAcceptError(c, inviteId, token, error);
  }
}

/** Register the engine mount and descriptor-driven login routes. */
export function registerEngineAuth(app: ShelfRouter, engine: Auth): void {
  app.all("/api/auth/*", async (c) => await engine.handler(c.req.raw));

  app.get("/auth/login", async (c) => {
    const methods = engine.loginMethods();
    const sole = methods.length === 1 ? methods.at(0) : undefined;
    if (sole?.kind === "oauth" || sole?.kind === "sso") {
      return c.redirect(`/auth/engine/${sole.id}`);
    }
    return await renderEngineLogin(c, engine);
  });

  app.post("/auth/engine/login", async (c) => await handleEngineLogin(c, engine));

  app.get("/auth/engine/:providerId", async (c) => await handleEngineStart(c, engine));

  app.get("/auth/invites/:inviteId", async (c) => await handleInvitePage(c, engine));

  app.post("/auth/invites/:inviteId", async (c) => await handleInviteAccept(c, engine));

  app.post("/auth/logout", async (c) => {
    const res = await forwardToEngine(c, engine, "/api/auth/sign-out", {});
    copySetCookies(c, res);
    // Mirror the Secure attribute or the clear-cookie misses Secure session
    // cookies over HTTPS (behind TLS-terminating proxies check forwarded proto).
    const secure =
      new URL(c.req.url).protocol === "https:" || c.req.header("x-forwarded-proto") === "https";
    c.header(
      "set-cookie",
      `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`,
      { append: true },
    );
    return hxRedirect(c, "/auth/login");
  });
}
