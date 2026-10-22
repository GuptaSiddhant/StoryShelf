import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { ShelfRouter } from "../app-types.ts";
import { connectionModel, findConnectable, type Connectable } from "../connections.ts";
import { getStore } from "../store.ts";
import { flash } from "./flash.ts";
import { forbidden, notFound, unauthorized } from "./helpers.ts";
import { safeReturnPath, signState, verifyState, type OAuthState } from "./oauth-state.ts";

const COOKIE = "storyshelf_oauth_state";
const COOKIE_PATH = "/connections";

/**
 * "Connect your account" for any service exposing OAuth (see `connectableServices`):
 * start → consent at the service → callback stores the user's own connection.
 * Services stay unaware of routes, state signing and storage.
 */
export function registerConnections(app: ShelfRouter): void {
  app.get("/connections/:service/start", handleStart);
  app.get("/connections/:service/callback", handleCallback);
  app.post("/connections/:service/disconnect", handleDisconnect);
}

function serviceOf(c: Context): Connectable {
  const service = findConnectable(c.req.param("service") ?? "");
  if (!service) notFound("Service does not support connecting accounts");
  return service;
}

function sessionUser(): { id: string } {
  const { user, authEnabled } = getStore();
  if (!authEnabled) notFound("Connecting accounts requires authentication");
  if (!user) unauthorized();
  return user;
}

function signingSecret(): string {
  const { secret } = getStore().config;
  if (!secret) notFound("Connecting accounts requires a configured server secret");
  return secret;
}

/**
 * Callback URL of an interactive, request-bound flow (ADR 0007): the confirmed public origin wins,
 * the request's own address is the fallback authentication is allowed.
 */
async function redirectUri(c: Context, kind: string): Promise<string> {
  const { publicOrigin, config } = getStore();
  const requestOrigin = new URL(c.req.url).origin;
  const base = publicOrigin
    ? await publicOrigin.authOrigin(requestOrigin)
    : (config.publicBaseUrl ?? requestOrigin);
  return `${base.replace(/\/+$/u, "")}/connections/${kind}/callback`;
}

async function handleStart(c: Context): Promise<Response> {
  const service = serviceOf(c);
  const user = sessionUser();
  const kind = service.metadata.kind;
  const { state, nonce } = signState(signingSecret(), {
    userId: user.id,
    service: kind,
    returnTo: safeReturnPath(c.req.query("return"), "/"),
  });
  setCookie(c, COOKIE, nonce, {
    path: COOKIE_PATH,
    httpOnly: true,
    sameSite: "Lax",
    maxAge: 600,
    secure: new URL(c.req.url).protocol === "https:",
  });
  return c.redirect(
    service.oauth.authorizeUrl({ state, redirectUri: await redirectUri(c, kind) }),
    302,
  );
}

async function handleCallback(c: Context): Promise<Response> {
  const service = serviceOf(c);
  const user = sessionUser();
  const verified = verifiedState(c, service.metadata.kind, user.id);
  const code = c.req.query("code");
  if (!code || c.req.query("error")) {
    flash(c, `${service.metadata.name} connection was cancelled`, "warning");
  } else {
    await completeConnect(c, service, user.id, code);
  }
  return c.redirect(verified.returnTo, 302);
}

/** Check the callback's signed state against the service, the signed-in user and this browser's cookie. */
function verifiedState(c: Context, kind: string, userId: string): OAuthState {
  const verified = verifyState(signingSecret(), c.req.query("state") ?? "");
  const nonce = getCookie(c, COOKIE);
  deleteCookie(c, COOKIE, { path: COOKIE_PATH });
  if (!verified || verified.service !== kind || verified.userId !== userId) forbidden();
  if (verified.nonce !== nonce) forbidden();
  return verified;
}

async function completeConnect(
  c: Context,
  service: Connectable,
  userId: string,
  code: string,
): Promise<void> {
  const kind = service.metadata.kind;
  try {
    const tokens = await service.oauth.exchangeCode({
      code,
      redirectUri: await redirectUri(c, kind),
    });
    await connectionModel().connect(userId, kind, tokens);
    flash(c, `${service.metadata.name} connected`);
  } catch (error) {
    getStore().logger.warn({ err: error, service: kind }, "oauth connect failed");
    flash(c, `Could not connect ${service.metadata.name}`, "danger");
  }
}

async function handleDisconnect(c: Context): Promise<Response> {
  const service = serviceOf(c);
  const user = sessionUser();
  const form = await c.req.formData();
  await connectionModel().remove(user.id, service.metadata.kind);
  flash(c, `${service.metadata.name} disconnected`);
  return c.redirect(safeReturnPath(formString(form.get("return")), "/"), 303);
}

function formString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}
