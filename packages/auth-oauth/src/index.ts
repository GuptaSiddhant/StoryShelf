import { SESSION_COOKIE, type AuthAdapter, type AuthCallback, type AuthUser } from "@storyshelf/core/adapter/auth";
import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface SessionPayload {
  userId: string;
  email: string;
  name: string;
  avatarUrl?: string;
  role: AuthUser["role"];
  expiresAt: number;
}

interface TokenResponse {
  access_token?: string;
}

interface UserInfoResponse {
  sub?: string;
  email?: string;
  name?: string;
  picture?: string;
}

export interface OAuthAuthOptions {
  issuer: string;
  clientId: string;
  clientSecret: string;
  secret: string;
  redirectUrl: string;
  scopes?: string[];
}

export interface OAuthAuth extends AuthAdapter {
  loginUrl(state: string): string;
}

function hmacHex(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function equalStrings(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function encodePayload(payload: SessionPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodePayload(body: string): SessionPayload | null {
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }
}

function signPayload(secret: string, payload: SessionPayload): string {
  const body = encodePayload(payload);
  return `${body}.${hmacHex(secret, body)}`;
}

function verifyPayload(secret: string, token: string): SessionPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot === -1) {
    return null;
  }
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!equalStrings(hmacHex(secret, body), signature)) {
    return null;
  }
  return decodePayload(body);
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) {
      continue;
    }
    if (part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return undefined;
}

function toUser(payload: SessionPayload): AuthUser {
  return {
    id: payload.userId,
    email: payload.email,
    name: payload.name,
    avatarUrl: payload.avatarUrl,
    role: payload.role,
  };
}

function buildLoginUrl(options: OAuthAuthOptions, scopes: string[], state: string): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUrl,
    response_type: "code",
    scope: scopes.join(" "),
    state,
  });
  return `${options.issuer}/protocol/openid-connect/auth?${params.toString()}`;
}

async function exchangeCode(options: OAuthAuthOptions, code: string): Promise<string | null> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: options.clientId,
    client_secret: options.clientSecret,
    redirect_uri: options.redirectUrl,
  });
  const response = await fetch(`${options.issuer}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!response.ok) {
    return null;
  }
  const data = (await response.json()) as TokenResponse;
  return data.access_token ?? null;
}

async function fetchUserInfo(
  options: OAuthAuthOptions,
  accessToken: string,
): Promise<AuthUser | null> {
  const response = await fetch(`${options.issuer}/protocol/openid-connect/userinfo`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    return null;
  }
  const info = (await response.json()) as UserInfoResponse;
  if (!info.sub) {
    return null;
  }
  return {
    id: info.sub,
    email: info.email ?? "",
    name: info.name ?? info.email ?? info.sub,
    avatarUrl: info.picture,
    role: "member",
  };
}

export function createOAuthAuth(options: OAuthAuthOptions): OAuthAuth {
  const { secret } = options;
  const scopes = options.scopes ?? ["openid", "email", "profile"];

  // Async is required by the AuthAdapter interface, though the logic is synchronous.
  // eslint-disable-next-line require-await
  const check = async (request: Request): Promise<AuthUser | null> => {
    const token = readCookie(request, SESSION_COOKIE);
    if (!token) {
      return null;
    }
    const payload = verifyPayload(secret, token);
    if (!payload || payload.expiresAt <= Date.now()) {
      return null;
    }
    return toUser(payload);
  };

  // eslint-disable-next-line require-await
  const createSession = async (user: AuthUser): Promise<string> => {
    const payload: SessionPayload = {
      userId: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      role: user.role,
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    return signPayload(secret, payload);
  };

  const handleCallback = async (callback: AuthCallback): Promise<AuthUser | null> => {
    const token = await exchangeCode(options, callback.code);
    if (!token) {
      return null;
    }
    return fetchUserInfo(options, token);
  };

  return {
    check,
    createSession,
    async destroySession() {
      await Promise.resolve();
    },
    handleCallback,
    loginUrl: (state: string) => buildLoginUrl(options, scopes, state),
  };
}
