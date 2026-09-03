import { createHash, randomBytes } from "node:crypto";
import type { Context, Next } from "hono";

const CSRF_SECRET = process.env["CSRF_SECRET"] ?? randomBytes(32).toString("hex");

function generateToken(sessionId: string): string {
  const timestamp = Date.now().toString(36);
  const payload = `${sessionId}:${timestamp}`;
  const signature = createHash("sha256").update(`${CSRF_SECRET}:${payload}`).digest("hex").slice(0, 16);
  return `${payload}:${signature}`;
}

function verifyToken(token: string, sessionId: string): boolean {
  const parts = token.split(":");
  if (parts.length !== 3) {
    return false;
  }
  const [payloadTimestamp, signature] = parts.slice(1);
  if (!payloadTimestamp || !signature) {
    return false;
  }
  const expectedSignature = createHash("sha256").update(`${CSRF_SECRET}:${sessionId}:${payloadTimestamp}`).digest("hex").slice(0, 16);
  if (signature !== expectedSignature) {
    return false;
  }
  const timestamp = Number.parseInt(payloadTimestamp, 36);
  const age = Date.now() - timestamp;
  return age > 0 && age < 24 * 60 * 60 * 1000;
}

export function csrf() {
  // oxlint-disable-next-line typescript/no-invalid-void-type -- Hono middleware may not return Response
  return async (c: Context, next: Next): Promise<Response | void> => {
    const {method} = c.req;
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      const sessionId = c.req.header("session-id") ?? "default";
      const token = generateToken(sessionId);
      c.header("X-CSRF-Token", token);
      await next();
      return;
    }
    const sessionId = c.req.header("session-id") ?? "default";
    const token = c.req.header("x-csrf-token") ?? c.req.query("csrf_token");
    if (!token || !verifyToken(token, sessionId)) {
      return c.json({ error: "Invalid CSRF token" }, 403);
    }
    await next();
  };
}

export function getCsrfToken(sessionId: string): string {
  return generateToken(sessionId);
}

