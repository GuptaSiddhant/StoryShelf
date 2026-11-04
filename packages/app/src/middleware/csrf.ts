import { readSessionCookie } from "@storyshelf/core/types";
import { timingSafeEqualString } from "@storyshelf/core/utils";
import type { Context, Next } from "hono";
import { createHash, randomBytes } from "node:crypto";

const DEFAULT_SESSION = "default";
const FALLBACK_SECRET = randomBytes(32).toString("hex");

/** Use the app secret when provided so tokens survive restarts and instances. */
function resolveSecret(secret?: string): string {
  return secret ?? FALLBACK_SECRET;
}

/** First part of a token. It names the format and carries nothing of the session (see below). */
const TOKEN_TAG = "csrf";

/**
 * `csrf:<timestamp>:<signature>`. The session id is signed but never put in the token: the token is
 * rendered into pages (meta tag, hidden fields) that scripts can read, and the id is the raw value
 * of the HttpOnly session cookie. `verifyToken` recomputes the signature from the request's own
 * session, and reads only the last two parts, so tokens issued before this format still verify.
 */
function generateToken(secret: string, sessionId: string): string {
  const timestamp = Date.now().toString(36);
  const signature = createHash("sha256")
    .update(`${secret}:${sessionId}:${timestamp}`)
    .digest("hex")
    .slice(0, 16);
  return `${TOKEN_TAG}:${timestamp}:${signature}`;
}

function verifyToken(secret: string, token: string, sessionId: string): boolean {
  const parts = token.split(":");
  if (parts.length !== 3) {
    return false;
  }
  const [payloadTimestamp, signature] = parts.slice(1);
  if (!payloadTimestamp || !signature) {
    return false;
  }
  const expectedSignature = createHash("sha256")
    .update(`${secret}:${sessionId}:${payloadTimestamp}`)
    .digest("hex")
    .slice(0, 16);
  if (!timingSafeEqualString(signature, expectedSignature)) {
    return false;
  }
  const timestamp = Number.parseInt(payloadTimestamp, 36);
  const age = Date.now() - timestamp;
  // Same-millisecond tokens are fresh (>= 0), not from the future.
  return age >= 0 && age < 24 * 60 * 60 * 1000;
}

/**
 * Session id for CSRF binding: the raw session cookie value, or "default"
 * for anonymous requests (login/invite forms have no session yet). A token
 * minted for one session never validates for another.
 */
export function sessionIdFrom(c: Pick<Context, "req">): string {
  return readSessionCookie(c.req.header("cookie")) ?? DEFAULT_SESSION;
}

/** Read a CSRF token from the request header or form body (never the URL: query tokens leak via logs, history, and Referer). */
async function tokenFromRequest(c: Context): Promise<string | undefined> {
  const header = c.req.header("x-csrf-token");
  if (header) {
    return header;
  }
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.includes("form")) {
    return undefined;
  }
  const body = await c.req.parseBody();
  const value = body["csrf_token"];
  return typeof value === "string" ? value : undefined;
}

/** Hono middleware issuing CSRF tokens on safe methods and verifying them on writes. */
export function csrf(secret?: string) {
  const resolvedSecret = resolveSecret(secret);
  // oxlint-disable-next-line typescript/no-invalid-void-type -- Hono middleware may not return Response
  return async (c: Context, next: Next): Promise<Response | void> => {
    const { method } = c.req;
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      c.header("X-CSRF-Token", generateToken(resolvedSecret, sessionIdFrom(c)));
      await next();
      return;
    }
    const token = await tokenFromRequest(c);
    if (!token || !verifyToken(resolvedSecret, token, sessionIdFrom(c))) {
      return c.json({ error: "Invalid CSRF token" }, 403);
    }
    await next();
  };
}

/** Generate a CSRF token for the given session (bound to the same secret as `csrf`). */
export function getCsrfToken(secret?: string, sessionId: string = DEFAULT_SESSION): string {
  return generateToken(resolveSecret(secret), sessionId);
}
