/** Signed, expiring OAuth `state` for "connect your account" flows (binds user, service and browser). */
import { timingSafeEqualString } from "@storyshelf/core/utils";
import { createHmac, randomBytes } from "node:crypto";

/** State lifetime: long enough to sign in at the service, short enough to limit replay. */
const STATE_TTL_MS = 10 * 60_000;

/** What a state asserts about the flow that issued it. */
export interface OAuthState {
  /** User who started the flow. */
  userId: string;
  /** Service `metadata.kind`. */
  service: string;
  /** Local path to return to afterwards. */
  returnTo: string;
  /** Random value also kept in a cookie, binding the state to one browser. */
  nonce: string;
  expiresAt: number;
}

/** Issue a signed state for a new flow, with a fresh nonce. */
export function signState(
  secret: string,
  fields: Omit<OAuthState, "nonce" | "expiresAt">,
  now = Date.now(),
): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString("hex");
  const body: OAuthState = { ...fields, nonce, expiresAt: now + STATE_TTL_MS };
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return { state: `${payload}.${mac(secret, payload)}`, nonce };
}

/** Parse and verify a state; null when forged, malformed or expired. */
export function verifyState(secret: string, state: string, now = Date.now()): OAuthState | null {
  const [payload, signature] = state.split(".");
  if (!payload || !signature || !timingSafeEqualString(signature, mac(secret, payload))) {
    return null;
  }
  try {
    const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
    return body.expiresAt > now ? body : null;
  } catch {
    return null;
  }
}

/** A same-site path (never an absolute or protocol-relative URL), else the fallback. */
export function safeReturnPath(value: string | undefined, fallback: string): string {
  return value && /^\/(?![/\\])/u.test(value) ? value : fallback;
}

function mac(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(`oauth-connect:${payload}`).digest("base64url");
}
