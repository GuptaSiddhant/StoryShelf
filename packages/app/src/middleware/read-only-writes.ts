/**
 * Read-only shared accounts (#1274): one middleware refuses every write such an account attempts, on
 * every path, with one fixed 403. The engine refuses its own endpoints too (`@storyshelf/auth`,
 * `readOnlyEngineGuard`); this layer covers the app's page and API routes and does not depend on it.
 */
import { READ_ONLY_ACCOUNT_MESSAGE, type Auth } from "@storyshelf/core/auth";
import { TokenModel, UserModel } from "@storyshelf/core/models";
import { readSessionCookie } from "@storyshelf/core/types";
import { sha256 } from "@storyshelf/core/utils";
import type { Context, MiddlewareHandler, Next } from "hono";
import { WRITE_METHODS } from "../routes/write-protection.ts";
import { getStore } from "../store.ts";
import { jsonRefusal } from "./api-errors.ts";

/**
 * The writes a read-only account may make: signing in (the app's form and the engine's sign-in
 * methods and their callbacks) and signing out. Everything else is refused.
 */
const READ_ONLY_ALLOWED_WRITES =
  /^\/(?:auth\/(?:logout|engine\/login)|api\/auth\/(?:sign-in\/[^/]+|sign-out|callback\/[^/]+|sso\/callback(?:\/[^/]+)?|sso\/saml2\/sp\/acs\/[^/]+|passkey\/verify-authentication))$/u;

/** The secret of a `Bearer` header, or undefined. */
function bearerSecret(c: Context): string | undefined {
  const header = c.req.header("authorization");
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
}

/** The email of the user owning bearer `secret` (a project token); undefined for any other secret. */
async function tokenOwnerEmail(secret: string): Promise<string | undefined> {
  const { db } = getStore();
  const token = await new TokenModel(db).findByHash(sha256(secret));
  if (!token?.userId) {
    return undefined;
  }
  return (await new UserModel(db).get(token.userId))?.email;
}

/**
 * The session user of a request that carries an `Authorization` header too. The store ignores the
 * cookie then (`resolveRequestUser`), but the engine does not, so the cookie is judged as well.
 */
async function cookieUserEmail(c: Context, auth: Auth): Promise<string | undefined> {
  if (readSessionCookie(c.req.header("cookie")) === undefined) {
    return undefined;
  }
  return (await auth.check(c.req.raw))?.email;
}

/** Whether any identity the request carries (session, cookie beside a header, token owner) is read-only. */
async function carriesReadOnlyAccount(
  c: Context,
  auth: Auth,
  isReadOnly: (email: string) => boolean,
): Promise<boolean> {
  const { user } = getStore();
  if (user && (user.readOnly === true || isReadOnly(user.email))) {
    return true;
  }
  if (c.req.header("authorization") === undefined) {
    return false;
  }
  const secret = bearerSecret(c);
  const emails = await Promise.all([
    secret === undefined ? undefined : tokenOwnerEmail(secret),
    cookieUserEmail(c, auth),
  ]);
  return emails.some((email) => email !== undefined && isReadOnly(email));
}

/** The one refusal: JSON under `/api/`, plain text for pages. */
function refuse(c: Context): Response {
  return c.req.path.startsWith("/api/")
    ? jsonRefusal(c, 403, READ_ONLY_ACCOUNT_MESSAGE)
    : c.text(READ_ONLY_ACCOUNT_MESSAGE, 403);
}

/**
 * Refuse (403) every `POST`, `PUT`, `PATCH` or `DELETE` made as a read-only account, except signing
 * in and out (`READ_ONLY_ALLOWED_WRITES`). The account is recognised by the session user, by the
 * session cookie when an `Authorization` header rides beside it, and by the owner of a bearer token,
 * so a token the account somehow holds maps to the same refusal. Reads pass untouched. Without an
 * auth adapter, or one without read-only accounts, it does nothing. Mount it inside the store scope.
 */
export function readOnlyWrites(auth: Auth | undefined): MiddlewareHandler {
  const isReadOnly = auth?.isReadOnlyAccount;
  // oxlint-disable-next-line typescript/no-invalid-void-type -- Hono middleware may not return Response
  return async (c: Context, next: Next): Promise<Response | void> => {
    if (
      !auth ||
      !isReadOnly ||
      !WRITE_METHODS.has(c.req.method) ||
      READ_ONLY_ALLOWED_WRITES.test(c.req.path)
    ) {
      await next();
      return;
    }
    if (await carriesReadOnlyAccount(c, auth, isReadOnly)) {
      return refuse(c);
    }
    await next();
  };
}
