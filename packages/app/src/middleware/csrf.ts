import { SESSION_COOKIE } from "@storyshelf/core/types";
import { timingSafeEqualString } from "@storyshelf/core/utils";
import type { Context, Next } from "hono";
import { createHash, randomBytes } from "node:crypto";

const DEFAULT_SESSION = "default";
const FALLBACK_SECRET = randomBytes(32).toString("hex");

/** Use the app secret when provided so tokens survive restarts and instances. */
function resolveSecret(secret?: string): string {
  return secret ?? FALLBACK_SECRET;
}

function generateToken(secret: string, sessionId: string): string {
  const timestamp = Date.now().toString(36);
  const payload = `${sessionId}:${timestamp}`;
  const signature = createHash("sha256").update(`${secret}:${payload}`).digest("hex").slice(0, 16);
  return `${payload}:${signature}`;
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
  const header = c.req.header("cookie") ?? "";
  for (const part of header.split(";")) {
    const eqIndex = part.indexOf("=");
    if (eqIndex !== -1 && part.slice(0, eqIndex).trim() === SESSION_COOKIE) {
      const value = part.slice(eqIndex + 1).trim();
      if (value) {
        return value;
      }
    }
  }
  return DEFAULT_SESSION;
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
